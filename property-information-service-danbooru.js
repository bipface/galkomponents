/* -------------------------------------------------------------------------- */

'use strict';

import * as tagExpression from './tag-expression.js';
import * as common from './common.js';
const {
	dbg,
	galk,
	assert,
	log,
	GalkError,} = common;

/* -------------------------------------------------------------------------- */

export const pendingSym = Symbol(`pending`);
const apiMaxPerPage = 100; /* danbooru: =<200; e621: =<250 */
const reqTimeoutMs = 10 * 1000; /* 10 seconds */
const maxBytesPerReq = 100 * 1000; /* 100 kb; basic precaution against
	bandwidth waste in buggy requests or responses */

const tagCategories = [
	`general`, `artist`, undefined, `copyright`, `character`, `meta`];

// todo: config
const reqCachePeriods = {/* units suitable for the 'expires_in' parameter */
	// autocomplete : `60mi`, // unused; see `getPropAutocompleteHref`
	summary : `5mi`, /* occasional; pages can be edited at any moment */
	userRelatedProps : `5mi`, /* dynamic */
	propRelatives : `20mi`, /* occasionally changes */
	sourceInfo : `60mi`, /* rarely changes? */
	propAttrs : `1mi`, /* dynamic; caching these is generally pointless since
		attrs are requested in arbitrary groups of 'apiMaxPerPage' */
};

const pendingReqs = {/* reqGroupName → ...reqs */
	autocomplete : new Set,
	summary : new Set,
	tagAttrs : new Set,
	userRelatedProps : new Set,
	propRelatives : new Set,
	sourceInfo : new Set,
};

/* tag attr requests are buffered into this queue
and fetched in groups of 'apiMaxPerPage' tags per http request: */
const tagsPendingAttrs = new Set;

/* tag attributes are gathered from various places,
so they're cached here instead of relying on the browser's own cache: */
const cachedTagAttrs = new Map; /* name → {category, postCount} */

/* could be removed in favour of browser's cache: */
const cachedTagSummaries = new Map; /* name → string */

let cachedUserId = -1;
/* could be removed in favour of browser's cache: */
let cachedUserRelatedTags = {
	frequent : [], /* original order preserved */
	recent : [], /* ordered by no. of occurrences desc, value asc */
};

/* could be removed in favour of browser's cache: */
const cachedTagRelatives = /* category → name → [...names] */
	[...tagCategories, ``, `wiki`]
		.reduce((o, c) =>({...o, [c] : new Map}), {});
/* [...names] should be ordered by relevance desc */

/* source info is gathered from various places,
so it's cached here instead of relying on the browser's own cache: */
const cachedSourceInfo = new Map; /* source → {pageHref : string|undefined} */

function cacheTagAttrs(name, attrObj) {
	dbg && assert.str(name);
	dbg && assert.obj(attrObj);
	Object.freeze(attrObj);
	cachedTagAttrs.set(name, attrObj);
};

function cacheTagSummary(name, s) {
	dbg && assert.str(name);
	dbg && assert.str(s);
	cachedTagSummaries.set(name, s);
};

function cacheSourceInfo(raw, info) {
	dbg && assert.str(raw);
	dbg && assert.obj(info);
	Object.freeze(info);
	cachedSourceInfo.set(raw, info);
};

let treeWalker = null; /* careful about using this in reentrant functions */
function ensureTreeWalkerForDoc(doc) {
	dbg && assert(doc instanceof HTMLDocument);
	if (treeWalker === null || treeWalker.root !== doc) {
		treeWalker = doc.createTreeWalker(doc,
			NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_COMMENT);};
	return treeWalker;
};

/* --- related props --- */

export function getPropRelatives(kind, value, category = ``,
	{fromCache = true, fromSvr = true} = {})
{
	/* returns:
		array - relatives
		null - no relatives available
		pendingSym - i/o pending */

	/* only tags: */
	if (kind !== `` /* tag */) {
		return null;};
	dbg && assert.str(value);
	dbg && assert.str(category);

	value = tagExpression.normaliseTag(value); /* lowercase */

	if (fromCache) {
		let relsMap = cachedTagRelatives[category];
		if (relsMap !== undefined) {
			dbg && assert(relsMap instanceof Map);
			let rels = relsMap.get(value);
			if (rels !== undefined) {
				dbg && assert.arr(rels);
				return rels;};
		};
	};

	if (!fromSvr) {
		return null;};

	requestTagRelatives(value, category, fromCache);
	return pendingSym;
};

async function requestTagRelatives(tag, category, fromCache) {
	dbg && assert.str(tag);
	dbg && assert.str(category);

	let rels = {/* category → tags */};

	let href = getTagRelativesHref(tag, category);
	try {
		let result = await httpGet({
			href,
			reqGroupName : `propRelatives`,
			responseType : `json`,
			fromCache,});

		if (typeof result !== `object` || !result) {
			throw malformedErr(href);};

		if (result.query !== tag
			|| (result.category || ``) !== category)
		{
			throw new GalkError(
				`response values don't match request`);};

		/* assumes results are ordered by relevance desc;
		note that `wiki_page_tags` ignores the category filter */

		if (category !== `wiki`) {
			let relTags = tryParseRawTagRels(result.tags, tag, category);
			if (relTags === null) {
				throw malformedErr(href);};

			rels[category] = Object.freeze(relTags);
		};

		{
			let relTags = tryParseRawTagRels(result.wiki_page_tags, tag, ``);
			if (relTags === null) {
				throw malformedErr(href);};

			rels[`wiki`] = Object.freeze(relTags);
		};

	} catch (err) {
		if (!(err instanceof RequestAborted)) {
			reportSvcError(
				`fetching relatives failed for `
					+`tag "${tag}", category "${category}"`,
				err);
		};
		rels = {};
	};

	/* cache results: */
	for (let k of Object.keys(rels)) {
		let relsMap = cachedTagRelatives[k];
		if (relsMap !== undefined) {
			dbg && assert(relsMap instanceof Map);
			relsMap.set(tag, rels[k]);
		};
	};

	/* note: tag-relative requests only yield partial tag attributes
	(categories but not counts) */

	internalEventTarget.dispatchEvent(
		new CustomEvent(
			galk.propRelativesRetrieved,
			{detail : {
				kind : `` /* tag */,
				value : tag,
				relatives : rels /* {category → tags} */,}}));
};

function tryParseRawTagRels(
	xs /* [...[name, categOrdinal]] */, excludeTag, expectCateg)
{
	/* returns:
		success → [...string]
		error → null */

	dbg && assert.str(expectCateg);
	if (!Array.isArray(xs)) {
		return null;};

	let rels = [];
	for (let i = 0, n = xs.length; i < n; ++i) {
		let tagAndCat = xs[i];
		if (!Array.isArray(tagAndCat) || tagAndCat.length !== 2) {
			return null;};

		let [tag, c] = tagAndCat;
		if (!isStringAndValidTag(tag) || !common.isInt32(c)) {
			return null;};
		
		if (tag === excludeTag) {continue;};

		if (expectCateg !== `` && tagCategories[c] !== expectCateg) {
			//return null; // danbooru bug #4335
			continue;};

		rels.push(tag);
	};

	return rels;
};

export function getUserRelatedProps(kind, userId, currentTime,
	{fromCache = true, fromSvr = true} = {})
{
	dbg && assert.uint31(userId);
	dbg && assert(currentTime instanceof Date && !isNaN(currentTime.getTime()));
	/* get user's frequently-used and recently-used tags */

	if (kind !== `` /* tag */) {
		return null;};

	if (fromCache && cachedUserId === userId) {
		dbg && assert.obj(cachedUserRelatedTags);
		return cachedUserRelatedTags;
	};

	if (!fromSvr) {
		return null;};

	requestUserRelatedTags(userId, currentTime, fromCache);
	return pendingSym;
};

async function requestUserRelatedTags(userId, currentTime, fromCache) {
	dbg && assert.uint31(userId);
	dbg && assert(currentTime instanceof Date && !isNaN(currentTime.getTime()));

	let createErrHdlr = (rel) => (function handleError(err) {
		if (!(err instanceof RequestAborted)) {
			reportSvcError(
				`fetching ${rel} tags failed for userId "${userId}"`, err);};
		return [];
	});

	let [fTags, rTags] = await Promise.all([
		requestUserFrequentTags(userId, fromCache)
			.catch(createErrHdlr(`frequent`)),
		requestUserRecentTags(userId, currentTime, fromCache)
			.catch(createErrHdlr(`recent`)),]);

	let results = Object.freeze({
		frequent : Object.freeze([...fTags]),
		recent : Object.freeze([...rTags]),});

	cachedUserId = userId;
	cachedUserRelatedTags = results;

	/* note: user-rel requests don't yield tag attributes */

	internalEventTarget.dispatchEvent(
		new CustomEvent(
			galk.userRelatedPropsRetrieved,
			{detail : {
				kind : `` /* tag */,
				userId,
				...results,}}));
};

async function requestUserFrequentTags(userId, fromCache) {
	/* returns a token sequence */

	dbg && assert.uint31(userId);

	let href = getUserFrequentTagsHref(userId);
	let result = await httpGet({
		href,
		reqGroupName : `userRelatedProps`,
		responseType : `json`,
		fromCache,});

	/* possible results:
		{id : ?, favourite_tags : `?`} - user has favourite tags
		{id : ?} - user doesn't have favourite tags
		{success : false} - user not found */

	if (typeof result !== `object` || !result) {
		throw malformedErr(href);};

	if (result.id !== userId) {
		let infix =
			typeof result.message === `string`
				? ` "${result.message}"`
				: ``;
		throw new GalkError(`error response`+infix+` from "${href}"`);
	};

	let tags = result.favorite_tags; /* note spelling */
	if (tags === undefined) {
		return [];};
	if (typeof tags !== `string`) {
		throw malformedErr(href);};

	return common.map(
		common.filter(
			tagExpression.parseTerms(tags),
			t => t.kind === `` /* tag */
				&& t.op === tagExpression.termOps.include
				&& tagExpression.isValidTag(t.value)),
		t => t.value);
};

async function requestUserRecentTags(userId, currentTime, fromCache) {
	/* returns a token sequence */

	dbg && assert.uint31(userId);
	dbg && assert(currentTime instanceof Date && !isNaN(currentTime.getTime()));

	let href = getUserRecentTagsHref(userId, currentTime);
	let results = await httpGet({
		href,
		reqGroupName : `userRelatedProps`,
		responseType : `json`,
		fromCache,});

	if (!Array.isArray(results)) {
		throw malformedErr(href);};

	let accTags = new Map; /* name → count */
	for (let i = 0, n = results.length; i < n; ++i) {
		let result = results[i];
		if (typeof result !== `object` || !result
			|| !Array.isArray(result.added_tags))
		{
			throw malformedErr(href);};

		let tags = result.added_tags;
		for (let j = 0, m = tags.length; j < m; ++j) {
			let tag = tags[j];
			if (!isStringAndValidTag(tag)) {
				throw malformedErr(href);};

			// todo: ignore metatags

			accTags.set(tag, (accTags.get(tag)|0) + 1);
		};
	};

	return common.map(
		common.sort(
			accTags.entries(),
			([t1, n1], [t2, n2]) => /* order by freq desc, name asc */
				common.defaultCompare(n2, n1)
				|| common.defaultCompare(t1, t2)),
		([tag, n]) => tag);
};

function getUserFrequentTagsHref(userId) {
	dbg && assert.uint31(userId);
	let url = new URL(`http://_/users/${userId}.json`);
	let s = url.searchParams;
	s.set(`only`, `id,favorite_tags`);
	s.set(`expires_in`, reqCachePeriods.userRelatedProps);

	return url.pathname+url.search; /* relative */
};

function getUserRecentTagsHref(userId, currentTime) {
	dbg && assert.uint31(userId);
	dbg && assert(currentTime instanceof Date && !isNaN(currentTime.getTime()));

	/* get added tags from user's 20 most recent edits in the last hour: */

	let url = new URL(`http://_/post_versions.json`);
	let s = url.searchParams;
	s.set(`limit`, `20`); // todo: config
	s.set(`only`, `added_tags`);
	s.set(`search[updater_id]`, `${userId}`);
	/* default order: versionId descending */

	 // todo: config
	let fromTime = new Date(currentTime.getTime() - (60*60*1000 /* 1 hour */));
	s.set(`search[updated_at]`,
		`${fromTime.toISOString()}..${currentTime.toISOString()}`);

	s.set(`expires_in`, reqCachePeriods.userRelatedProps);

	return url.pathname+url.search; /* relative */
};

function getTagRelativesHref(tag, category) {
	dbg && assert.str(tag);
	dbg && assert.str(category);

	let url = new URL(`http://_/related_tag.json`);
	let s = url.searchParams;
	s.set(`limit`, `25`); // todo: config
	s.set(`query`, tag);
	if (category !== ``) {
		s.set(`category`, category);};

	s.set(`expires_in`, reqCachePeriods.propRelatives);

	return url.pathname+url.search; /* relative */
};

/* --- autocomplete --- */

export function requestPropAutocompleteValues(kind, partial) {
	/* only tag autocomplete: */
	if (kind !== `` /* tag */ || typeof partial !== `string`) {
		return null;};
		
	partial = tagExpression.normaliseTag(partial); /* lowercase */

	requestTagAutocompleteValues(partial);

	return pendingSym;
};

async function requestTagAutocompleteValues(partial) {
	/* only one autocomplete request in-flight at a time: */
	abortRequestGroup(`autocomplete`);

	let href = getPropAutocompleteHref(`` /* tag */, partial);
	let resultsArr = [];
	let attrEntries = [];
	try {
		let rawResults = await httpGet({
			href,
			reqGroupName : `autocomplete`,
			responseType : `json`,});

		let results = tryParseRawTagAutocmplResults(rawResults);
		if (results === null) {
			throw malformedErr(href);};

		for (let r of results) {
			if (r === null) {
				throw malformedErr(href);};

			let {name, antecedent, attrs} = r;
			dbg && assert.str(name);
			resultsArr.push({value : name, antecedent});

			/* only cache attrs if not already present
			(because http cache expiry for attr requests may be shorter): */
			if (!cachedTagAttrs.has(name)) {
				cacheTagAttrs(name, attrs);
				dbg && assert(Object.isFrozen(attrs));
				attrEntries.push([name, attrs]);
			};
		};

	} catch (err) {
		if (!(err instanceof RequestAborted)) {
			reportSvcError(
				`fetching autocomplete values failed for partial "${partial}"`,
				err);
		};
	};

	/* results are of the form {value, antecedent} */
	internalEventTarget.dispatchEvent(
		new CustomEvent(
			galk.autocompleteResults,
			{detail : {
				kind : `` /* tag */,
				partial,
				results : resultsArr /* [...{value, antecedent}] */,}}));

	if (attrEntries.length !== 0) {
		internalEventTarget.dispatchEvent(
			new CustomEvent(
				galk.propAttrsRetrieved,
				{detail : {
					kind : `` /* tag */,
					entries : attrEntries /* [...[value, attrs]] */,}}));
	};
};

function tryParseRawTagAutocmplResults(xs) {
	if (!common.isIterable(xs)) {return null;};
	return common.map(xs, x => {
		let attrs = tryParseRawTagAttrs(x);
		if (attrs === null || typeof x.value !== `string`) {
			return null;};

		let rv = {name : x.value, attrs};
		if (isStringAndValidTag(x.antecedent)) {
			rv.antecedent = x.antecedent;};

		return rv;
	});
};

function getPropAutocompleteHref(kind, partial) {
	if (kind !== `` /* tag */) {return undefined;};
	dbg && assert.str(partial);

	let url = new URL(`http://_/autocomplete.json`);
	let s = url.searchParams;

	/* to avoid cloudflare cache misses, params must be exactly as follows,
	in this order: */
	s.set(`search[query]`, partial);
	s.set(`search[type]`, `tag_query`);
	s.set(`limit`, `10`); // todo: config; though see above

	// excluded to avoid cloudflare cache misses:
	//s.set(`expires_in`, reqCachePeriods.autocomplete);
	//s.set(`only`, `value,post_count,category,antecedent`); // danbooru bug #4240

	return url.pathname+url.search; /* relative */
};

/* --- summaries --- */

export function getPropSummary(kind, value,
	{fromCache = true, fromSvr = true} = {})
{
	/* only tag summaries: */
	if (kind !== `` /* tag */ || typeof value !== `string`) {
		return ``;};

	value = tagExpression.normaliseTag(value); /* lowercase */

	if (fromCache) {
		let s = cachedTagSummaries.get(value);
		if (s !== undefined) {
			dbg && assert.str(s);
			return s;
		};
	};

	if (fromSvr) {
		requestTagSummary(value, fromCache);
		return pendingSym;
	};

	return ``;
};

async function requestTagSummary(value, fromCache) {
	/* only one summary request in-flight at a time: */
	abortRequestGroup(`summary`);

	let summary = ``;
	let href = getPropWikiContentHref(`` /* tag */, value);
	try {
		let rawResults = await httpGet({
			href,
			reqGroupName : `summary`,
			responseType : `json`,
			fromCache,});

		if (rawResults === null
			|| !common.isIterable(rawResults)
			|| common.count(rawResults, 2) > 1)
		{
			throw malformedErr(href);};

		let r = common.first(rawResults);
		if (r !== undefined) {
			if (typeof r !== `object` || !r || typeof r.body !== `string`) {
				throw malformedErr(href);};

			/* danbooru sometimes gives non-exact matches on wiki searches,
			e.g. /wiki_pages/_brown__hair_ → brown_hair */
			if (r.title === value) {
				summary = r.body;};
		} else {
			/* no summary found */};

		cacheTagSummary(value, summary);

	} catch (err) {
		if (!(err instanceof RequestAborted)) {
			reportSvcError(`fetching summary failed for tag "${value}"`, err);};
	};

	internalEventTarget.dispatchEvent(
		new CustomEvent(
			galk.propSummaryRetrieved,
			{detail : {
				kind : `` /* tag */,
				value,
				summary,}}));
};

function getPropWikiContentHref(kind, value) {
	switch (kind) {
		default : return undefined;

		case `` /* tag */ : {
			if (value === ``
				|| !common.every(value, c => // todo
					common.codePointIsGraphicalAscii(c.charCodeAt(0))))
			{
				return undefined;};

			let url = new URL(`http://_/wiki_pages.json`);
			let s = url.searchParams;
			s.set(`limit`, `1`);
			s.set(`only`, `title,body`);
			s.set(`search[hide_deleted]`, `y`);
			s.set(`search[title]`, value);
			s.set(`expires_in`, reqCachePeriods.summary);

			return url.pathname+url.search; /* relative */
		};
	};
};

/* --- attributes --- */

export function getPropAttrs(kind, value,
	{fromCache = true, fromSvr = true} = {})
{
	/* returns:
		object - attributes
		null - no attributes available
		pendingSym - i/o pending */

	dbg && assert.bool(fromSvr);
	dbg && assert(fromCache === true,
		`getPropAttrs can't be called with fromCache value "${fromCache}"`);
	/* fromCache must be consistent since all requests are queued in
	a common buffer */

	/* only tag attrs: */
	if (kind !== `` /* tag */) {return null;};

	value = tagExpression.normaliseTag(value); /* lowercase */

	if (fromCache) {
		let attrs = cachedTagAttrs.get(value);
		if (attrs !== undefined) {
			dbg && assert.obj(attrs);
			return attrs;
		};
	};

	if (fromSvr) {
		let wasEmpty = tagsPendingAttrs.size === 0;
		tagsPendingAttrs.add(value);
		if (wasEmpty) {
			common.queueMicrotask(requestPendingTagAttrs);};
		return pendingSym;
	};

	return null;
};

async function requestPendingTagAttrs() {
	try {
		while (tagsPendingAttrs.size > 0) {
			/* request attributes for the next (up to) N pending tags: */
			let tags = new Set(
				common.subseq(tagsPendingAttrs, 0, apiMaxPerPage));

			let href = getTagAttrsHref(tags);

			let entries = [];
			let outstandingTags = new Set(tags);
			try {
				let rawResults = await httpGet({
					href,
					reqGroupName : `tagAttrs`,
					responseType : `json`,});

				let results = tryParseDanbooruTagAttrResults(rawResults);
				if (results === null) {
					throw malformedErr(href);};

				for (let r of results) {
					if (r === null) {
						throw malformedErr(href);};

					let {name, attrs} = r;

					if (!outstandingTags.has(name)) {
						throw new GalkError(
							`response includes unexpected `
								+`or duplicated tag "${name}"`);};
					outstandingTags.delete(name);

					entries.push([name, attrs]);

					cacheTagAttrs(name, attrs);
				};

			} catch (err) {
				if (!(err instanceof RequestAborted)) {
					reportSvcError(
						`fetching attributes failed for tags `
							+common.joinString(
								common.map(tags, x => `"${x}"`), `, `), err);
				};
				abortPendingTagAttrs();
				return;
			};

			if (outstandingTags.size > 0) {
				/* no results for some of the requested tags */

				reportSvcWarning(`no attributes found for tags `
					+common.joinString(
						common.map(outstandingTags, x => `"${x}"`), `, `));

				for (let tag of outstandingTags) {
					entries.push([tag, null]);
					/* cache the absence of attributes: */
					cacheTagAttrs(name, {});
				};
			};
			outstandingTags.clear();

			/* remove tags from the pending list: */
			for (let tag of tags) {
				tagsPendingAttrs.delete(tag);};
			tags.clear();

			internalEventTarget.dispatchEvent(
				new CustomEvent(
					galk.propAttrsRetrieved,
					{detail : {
						kind : `` /* tag */,
						entries /* [[value, attrs], …] */,}}));

			tags = undefined;
		};
	} catch (err) {
		log.error(err);
		abortPendingTagAttrs();
	};
};

function tryParseDanbooruTagAttrResults(xs) {
	if (!common.isIterable(xs)) {return null;};
	return common.map(xs, x => {
		let attrs = tryParseRawTagAttrs(x);
		if (attrs === null || typeof x.name !== `string`) {return null;};
		return {name : x.name, attrs};
	});
};

function abortPendingTagAttrs() {
	let tags = tagsPendingAttrs;
	if (tags.size === 0) {return;};

	dbg && log.debug(`aborting attributes request for tags:`, [...tags]);

	let entries = [...common.map(tags, t => [t, null])];
	tagsPendingAttrs.clear();

	internalEventTarget.dispatchEvent(
		new CustomEvent(
			galk.propAttrsRetrieved,
			{detail : {
				kind : `` /* tag */,
				entries /* [...[value, null]] */,}}));
};

export function extractTagAttrsFromList(node) {
	/* node can be any element which has <li> descendants representing tags;
	on danbooru this would typically be <section id='tag-list'>;
	should work with tag lists in all known danbooru and gelbooru variants

	doesn't perform normalisation (assumes tags are normalised already) */

	dbg && assert(node instanceof HTMLElement);
	let doc = node.ownerDocument;

	/* statistics: */
	let nNames = 0;
	let nCategs = 0;
	let nCounts = 0;

	ensureTreeWalkerForDoc(doc);
	treeWalker.currentNode = node;

	let endNode = doc.createComment(``);
	node.after(endNode);

	let attrObj = null;
	try {
		do {
			dbg && assert(
				(node.compareDocumentPosition(endNode)
				& Node.DOCUMENT_POSITION_FOLLOWING) !== 0);

			if (node instanceof HTMLLIElement) {
				/* <li class='category-0 tag-type-general'> */

				if (attrObj !== null && attrObj.name !== undefined) {
					cacheTagAttrs(attrObj.name, attrObj);};

				attrObj = {};

				let clss = node.classList;
				for (let i = 0, n = clss.length; i < n; ++i) {
					let cls = clss.item(i);
					dbg && assert.str(cls);

					if (cls.startsWith(`category-`)
						|| cls.startsWith(`tag-type-`))
					{
						let rawCat = cls.slice(9);
						let cat = undefined;
						let catOrdinal = common.tryParseUint31(rawCat);
						if (catOrdinal >= 0) {
							/* ordinal category e.g. 'category-1' */
							cat = tagCategories[catOrdinal];
						} else if (tagCategories.includes(rawCat)) {
							/* named category e.g. 'category-meta' */
							cat = rawCat;};

						if (cat !== undefined) {
							attrObj.category = cat;
							dbg && (++nCategs);
						};
					};
				};

			} else if (attrObj === null) {
				/* no <li> encountered yet */

			} else if (node instanceof HTMLAnchorElement) {
				/* <a href='/posts?tags=x'> */

				let sRaw = node.search;
				if (sRaw.length > 5) {
					let name = (new URLSearchParams(sRaw)).get(`tags`);
					if (isStringAndValidTag(name)) {
						attrObj.name = name;
						dbg && (++nNames);
					};
				};

			} else if (node instanceof HTMLElement
				&& node.childElementCount === 0)
			{
				/* <span class='post-count' title='5000'>5k</span> */

				let cls = node.classList;
				if (cls.contains(`post-count`)
					/* gelbooru: */
					|| (cls.length === 0 && node instanceof HTMLSpanElement))
				{
					let n = common.tryParseUint31(
						node.title || node.textContent.trim());
					if (n >= 0) {
						attrObj.postCount = n;
						dbg && (++nCounts);
					};
				};
			};

			node = treeWalker.nextNode();
		} while (node !== null && node !== endNode);

	} finally {
		endNode.remove();};

	if (attrObj !== null && attrObj.name !== undefined) {
		cacheTagAttrs(attrObj.name, attrObj);};

	dbg && log.debug(`extracted ${nNames} tag names, `
		+`${nCategs} categorisations, `
		+`${nCounts} post-count values`);
};

function getTagAttrsHref(tags) {
	dbg && assert.sequ(tags);

	let url = new URL(`http://_/tags.json`);
	let s = url.searchParams;
	s.set(`limit`, `${apiMaxPerPage}`);
	s.set(`only`, `name,post_count,category`);
	s.set(`expires_in`, reqCachePeriods.propAttrs);
	s.set(`search[hide_empty]`, `no`);
	s.set(`search[name_comma]`, common.joinString(
		/* can't lookup tags containing commas */
		common.filter(tags, t => !t.includes(`,`)),
		`,`));

	return url.pathname+url.search; /* relative */
};

function tryParseRawTagAttrs(x) {
	if (typeof x !== `object` || !x) {return null;};
	let rv = {};

	if (common.isInt32(x.category) && (x.category in tagCategories)) {
		rv.category = tagCategories[x.category];};

	if (common.isInt32(x.post_count) && x.post_count >= 0) {
		rv.postCount = x.post_count;};

	return rv;
};

/* --- sources --- */

export function getSourceInfo(src,
	{fromCache = true, fromSvr = true} = {})
{
	/* returns:
		object - source info
		null - no info available
		pendingSym - i/o pending */

	dbg && assert.str(src);
	dbg && assert.bool(fromCache);
	dbg && assert.bool(fromSvr);

	if (src.length === 0) {
		return null;};

	if (fromCache) {
		let info = cachedSourceInfo.get(src);
		if (info !== undefined) {
			dbg && assert.obj(info);
			return info;
		};
	};

	if (fromSvr) {
		getSourceInfoInternal(src, {fromCache, fromSvr});
		return pendingSym;
	};

	return null;
};

async function getSourceInfoInternal(src, {fromCache, fromSvr}) {
	let info = {pageHref : null};
	let href = getSourceInfoHref(src);
	try {
		let result = await httpGet({
			href,
			reqGroupName : `sourceInfo`,
			responseType : `json`,
			fromCache, fromSvr,});

		if (typeof result !== `object` || !result) {
			throw malformedErr(href);};

		info = tryParseSourceInfo(src, {pageHref : result.page_url});
		cacheSourceInfo(src, info);

	} catch (err) {
		if (!(err instanceof RequestAborted)) {
			reportSvcError(`fetching info failed for source "${src}"`, err);};
	};

	/* list of [src, info] entries: */
	internalEventTarget.dispatchEvent(
		new CustomEvent(
			galk.sourceInfosRetrieved,
			{detail : [[src, info]]}));
};

function getSourceInfoHref(src) {
	dbg && assert.str(src);

	let url = new URL(`http://_/source.json`);
	let s = url.searchParams;
	s.set(`only`, `artists,translated_tags,page_url`);
	s.set(`expires_in`, reqCachePeriods.sourceInfo);
	s.set(`url`, src);

	return url.pathname+url.search; /* relative */
};

function tryParseSourceInfo(raw, {pageHref}) {
	dbg && assert.str(raw);
	dbg && assert(raw.length !== 0);

	let pageUrl = raw !== pageHref ? common.tryParseHref(pageHref) : null;
	return {
		pageHref : common.isSafeUrl(pageUrl) ? pageUrl.href : undefined,
		abbrevHref : abbreviatedHref(pageUrl || common.tryParseHref(raw)),};
};

function abbreviatedHref(u) {
	if (common.isSafeUrl(u)) {
		return ((/* trim protocol and www. */
			u.hostname.length > 4 && u.hostname.startsWith(`www.`)
				? u.host.slice(4)
				: u.host)
			+u.pathname+u.search+u.hash);
	};

	return undefined;
};

export function extractSourceInfoFromList(node) {
	/* on danbooru, node would be <li id='post-info-source'>
	though note that danbooru only has one source per post */

	dbg && assert(node instanceof HTMLElement);
	let doc = node.ownerDocument;

	ensureTreeWalkerForDoc(doc);
	treeWalker.currentNode = node;

	let endNode = doc.createComment(``);
	node.after(endNode);

	let urls = [];
	try {
		do {
			dbg && assert(
				(node.compareDocumentPosition(endNode)
				& Node.DOCUMENT_POSITION_FOLLOWING) !== 0);

			if (node instanceof HTMLAnchorElement) {
				urls.push(node.href);};

			node = treeWalker.nextNode();
		} while (node !== null && node !== endNode);

	} finally {
		endNode.remove();};

	let [pageHref, raw] = urls; /* assumes #post-info-source has =< two <a> */

	if (raw) {
		cacheSourceInfo(raw,
			tryParseSourceInfo(raw, {pageHref}));
		dbg && log.debug(`extracted one source info`);
	};
};

/* --- miscellaneous --- */

export function getPropGotoHref(term) {
	dbg && tagExpression.assertTerm(term);
	switch (term.kind) {
		default : return undefined;

		case `` /* tag */ : {
			if (!isStringAndValidTag(term.value)) {
				return undefined;};

			let norm = tagExpression.normaliseTag(term.value); /* lowercase */
			let url = new URL(`http://_/posts`);
			url.searchParams.set(`tags`, norm);

			return url.pathname+url.search; /* relative */
		};

		case `parent` : {
			if (term.value === ``
				|| !common.every(term.value, c =>
					common.codePointIsDigit(c.charCodeAt(0))))
			{
				return undefined;};

			let url = new URL(`http://_/posts`);
			url.searchParams.set(`tags`, `parent:`+term.value);

			return url.pathname+url.search; /* relative */
		};

		case `source` : {
			let url = common.tryParseHref(term.value);
			if (url === null || !common.isSafeUrl(url)) {
				return undefined;};
			return url.href;
		};
	};
};

export function getPropWikiPageHref(term) {
	dbg && tagExpression.assertTerm(term);
	let url;

	switch (term.kind) {
		case `source` :
			url = new URL(`http://_/wiki_pages/help:image_source`); break;
		case `parent` :
			url = new URL(`http://_/wiki_pages/help:post_relationships`); break;
		case `rating` :
			url = new URL(`http://_/wiki_pages/howto:rate`); break;

		case `` /* tag */ :
			if (term.value === ``) {
				url = new URL(`http://_/wiki_pages/howto:tag`);
				break;};

			if (!isStringAndValidTag(term.value)) {
				return undefined;};

			let norm = tagExpression.normaliseTag(term.value); /* lowercase */

			url = new URL(
				`http://_/wiki_pages/${encodeURIComponent(norm)}`);
			break;

		default : return undefined;
	};

	return url.pathname; /* relative */
};

function reportSvcError(msg, errObj) {
	dbg && assert(typeof msg === `string` || msg === undefined);
	dbg && assert(typeof msg === `string` || errObj instanceof Error);
	if (msg) {
		errObj = new GalkError(msg, errObj);};

	log.error(errObj);

	internalEventTarget.dispatchEvent(
		new CustomEvent(
			galk.serviceError,
			{detail : errObj}));
};

function reportSvcWarning(msg) {
	dbg && assert.str(msg);
	log.warn(msg);

	internalEventTarget.dispatchEvent(
		new CustomEvent(
			galk.serviceWarning,
			{detail : msg}));
};

function malformedErr(href) {
	return new GalkError(`malformed response from "${href}"`);
};

function isStringAndValidTag(s) {
	return typeof s === `string` && tagExpression.isValidTag(s);
};

/* --- http --- */

async function httpGet(opts) {
	/* success → resolves to response object
	error → rejects with GalkError
	aborted → rejects with RequestAborted */
	return new Promise(httpGetInternal.bind(null, opts));
};

function httpGetInternal(
	/* bound: */ {reqGroupName, href, responseType,
		fromCache = true, fromSvr = true},
	/* promise: */ resolve, reject)
{
	dbg && assert.str(href);
	dbg && assert.str(responseType);
	dbg && assert.str(reqGroupName);
	dbg && assert.bool(fromCache);
	dbg && assert.bool(fromSvr);

	let reqGroup = pendingReqs[reqGroupName];
	dbg && assert(reqGroup instanceof Set);

	let req = new XMLHttpRequest;

	req.responseType = responseType;
	req.timeout = reqTimeoutMs;

	req.onload = req.onabort = req.onerror = req.ontimeout =
		onHttpGetFinish.bind(null, reqGroup, resolve, reject);

	req.onloadstart = req.onprogress = onHttpGetProgress;

	dbg && log.debug(`opening GET request`, {href});
	req.open(`GET`, href);

	if (responseType === `json`) {
		req.setRequestHeader(`accept`, `application/json`);}

	if (!fromSvr) {
		req.setRequestHeader(`cache-control`, `only-if-cached`);};
	if (!fromCache) {
		req.setRequestHeader(`cache-control`, `no-cache`);};

	reqGroup.add(req);
	req.send();
};

class RequestAborted extends GalkError {};
function onHttpGetFinish(
	/* bound: */ reqGroup, resolve, reject,
	/* event: */ {type : evType, currentTarget : req})
{
	req.onload = req.onabort = req.onerror = req.ontimeout = null;
	reqGroup.delete(req);

	let href = req.responseURL;
	let status = `${req.status}`;
	if (req.statusText) {
		status += ` "${req.statusText}"`;};

	if (evType === `load`
		&& ((200 <= req.status && req.status < 300)
			|| req.status === 304 /* 'not modified' */))
	{
		resolve(req.response);
		dbg && log.debug(
			`GET request succeeded with status ${status}`, {href});

	} else if (evType === `abort`) {
		reject(new RequestAborted);
		dbg && log.debug(`GET request was aborted`, {href});

	} else {
		let err = new GalkError(
			`GET request failed with status ${status}`);
		reject(err);
		dbg && log.error(err, {href});
	};
};

function abortRequestGroup(name) {
	dbg && assert.str(name);
	let g = pendingReqs[name];
	if (g !== undefined) {
		/* it should be safe to delete entries while the forEach is running */
		g.forEach(req => {req.abort();});
	};
};

function onHttpGetProgress(ev) {
	let req = ev.currentTarget;

	if (req.readyState === XMLHttpRequest.UNSENT
		|| req.readyState === XMLHttpRequest.DONE)
	{
		return;};

	if (ev.loaded > maxBytesPerReq
		|| (ev.lengthComputable && ev.total > maxBytesPerReq))
	{
		reportSvcError(`(onHttpGetProgress)`); // todo
		req.abort();
	};
};

/* --- event target --- */

const internalEventTarget = /* new EventTarget */ new DocumentFragment;

export function addEventListener(...args) {
	internalEventTarget.addEventListener(...args);
};

export function removeEventListener(...args) {
	internalEventTarget.removeEventListener(...args);
};

/* -------------------------------------------------------------------------- */

/*



















































*/

/* -------------------------------------------------------------------------- */