/* -------------------------------------------------------------------------- */

'use strict';

import * as common from './common.js';
import * as prims from './primitives.js';
import * as propInfoSvc from './property-information-service-danbooru.js';
import * as tagExpression from './tag-expression.js';
import * as propertySheet from './property-sheet-booru.js';
const {
	dbg,
	galk,
	assert,
	first,
	log,
	codePointIsWhitespace,} = common;
const {normaliseTerm, termOps} = tagExpression;

/* -------------------------------------------------------------------------- */

const adapterInstigator = Symbol(); /* represents the adapter itself */

/* --- searchbar --- */

export function bindSearchTermsField(psRoot, inputEl) {
	dbg && assert(inputEl instanceof HTMLInputElement);

	let upd = updatePsFromSearchTermsField.bind(null, psRoot, inputEl);

	inputEl.addEventListener(`input`,
		prims.ensureDebouncedHdlr(inputEl, `input`, upd), false);

	upd();

	psRoot.addEventListener(galk.intent.assignSearchTerm,
		onPropertySheetAssignSearchTermIntent.bind(null, inputEl), false);
};

function updatePsFromSearchTermsField(psRoot, inputEl) {
	dbg && log.debug(`updatePsFromSearchTermsField`);
	let rawXpr = inputEl.value;

	propertySheet.replaceAllSearchTerms(psRoot, {
		instigator : adapterInstigator,
		terms : common.filter(
			tagExpression.parseTerms(rawXpr),
			term => !term.hasWildcard /* ignore */),
	});
};

function onPropertySheetAssignSearchTermIntent(
	/* bound: */ fieldEl, /* searchbar */
	/* event: */ {currentTarget : psRoot,
		detail : {term : searchTerm, instigator}})
{
	dbg && assert(instigator !== adapterInstigator);

	/* op may be '', '-' or `undefined` (absent) */
	let absent = Symbol();
	let applicandTerms =
		searchTerm.op === undefined
			? [{...searchTerm, op : absent}]
			: [searchTerm];

	/* apply changes to the field element's contents: */

	let rawXpr = fieldValOrDefault(fieldEl);
	let rawLen = rawXpr.length;
	let lenOffset = 0;

	for (let {term, changed, beginIndex, endIndex} of
		tagExpression.operateXpr(rawXpr, applicandTerms, normaliseTerm))
	{
		dbg && assert(beginIndex <= endIndex);
		if (!changed) {continue;};

		let origLen = endIndex - beginIndex;

		if (term === null || term.op === absent) {
			if (origLen === 0) {
				/* nothing to do */
			} else {
				dbg && assert(origLen > 0);
				dbg && assert(beginIndex < rawLen);
				dbg && assert(endIndex <= rawLen);

				/* delete: */

				fieldEl.setRangeText(``,
					beginIndex + lenOffset,
					endIndex + lenOffset);

				lenOffset -= origLen;
			};

		} else {
			let s = tagExpression.tryFormatTerm(term);
			if (s === undefined) {
				/* ignore: */
				log.warn(`can't represent term as a wellformed tag expression`,
					term);

			} else if (beginIndex >= rawLen) {
				dbg && assert(origLen === 0);

				/* append: */

				if (beginIndex > rawLen) {
					s = ` `+s;};

				fieldEl.setRangeText(s,
					rawLen + lenOffset,
					rawLen + lenOffset);

				lenOffset += s.length;

			} else {
				/* replace: */

				if (endIndex < rawLen) {
					s += ` `;};

				fieldEl.setRangeText(s,
					beginIndex + lenOffset,
					endIndex + lenOffset);

				lenOffset += s.length - origLen;
			};
		};
	};

	// todo: consolidate with assignTermsToTextRange

	propertySheet.assignSearchTerms(psRoot, {terms : [searchTerm], instigator});
};

/* --- edit form --- */

export function bindForm(psRoot, formEl) {
	dbg && assert(formEl instanceof HTMLFormElement);

	/* gather field elements: */

	let origTagsField = findFieldById(formEl, `post_old_tag_string`);
	let origParentField = findFieldById(formEl, `post_old_parent_id`);
	let origSourceField = findFieldById(formEl, `post_old_source`);
	let origRatingField = findFieldById(formEl, `post_old_rating`);

	let tagsField = findFieldById(formEl, `post_tag_string`);
	let sourceField = findFieldById(formEl, `post_source`);
	let parentField = findFieldById(formEl, `post_parent_id`);

	// the `embedded:` metatag isn't currently recognised by danbooru
	let embedModeBtn = null; //findFieldById(formEl, `post_has_embedded_notes`);

	let ratingBtns = [
		findFieldById(formEl, `post_rating_s`),
		findFieldById(formEl, `post_rating_q`),
		findFieldById(formEl, `post_rating_e`),]
		.filter(el => el !== null);

	/* gather original (unedited) properties: */

	let origTerms = [
		...common.filter(
			tagExpression.parseTerms(
				fieldValOrDefault(origTagsField)),
			({kind, op}) => (op === termOps.include)),

		{kind : `parent`, op : ``,
			value : fieldValOrDefault(origParentField).trim()},

		{kind : `source`, op : ``,
			value : fieldValOrDefault(origSourceField).trim()},

		{kind : `rating`, op : ``,
			value : fieldValOrDefault(origRatingField).trim()},];

	if (embedModeBtn !== null) {
		origTerms.push({kind : `embedded`, op : ``,
			value : `${embedModeBtn.hasAttribute('checked')}`});};

	/* gather edited terms: */

	let terms = [
		{kind : `parent`, op : ``,
			value : fieldValOrDefault(parentField).trim()},

		{kind : `source`, op : ``,
			value : fieldValOrDefault(sourceField).trim()},];

	{
		let checkedEl = null;
		for (let el of ratingBtns) {
			/* reset persisted dynamic checked state: */
			let isChecked = el.hasAttribute(`checked`);
			el.checked = isChecked;
			if (isChecked) {checkedEl = el;};
		};

		if (checkedEl !== null) {
			terms.push({kind : `rating`, op : ``, value : checkedEl.value});};
	};

	if (embedModeBtn !== null) {
		terms.push({kind : `embedded`, op : ``,
			value : `${embedModeBtn.checked}`});};

	for (let t of tagExpression.parseTerms(
		fieldValOrDefault(tagsField)))
	{
		if (t.op !== termOps.include && t.op !== termOps.exclude) {
			continue; /* ignore invalid ops in the tags field (~) */};

		terms.push(t);

		/* note: metatags in the tags field override the individual fields */
	};

	/* assign terms to tags field: */

	tagsField.value = ``;
	{
		let offset = 0;
		for (let t of terms) {
			let s = tagExpression.tryFormatTerm(t);
			if (s !== undefined) {
				tagsField.setRangeText(s+` `, offset, offset);
				offset += s.length + 1;
			};
		};

		// todo: determine whether repeated calls of `setRangeText` is
		// more or less efficient than building a huge string and assigning
		// `.value` directly
	};

	/* disable individual fields:
	note: disabled fields are excluded from form submission */

	if (parentField !== null) {parentField.disabled = true;};
	if (sourceField !== null) {sourceField.disabled = true;};
	if (embedModeBtn !== null) {embedModeBtn.disabled = true;};
	for (let el of ratingBtns) {el.disabled = true;};

	// this hidden field must also be disabled, otherwise the form submission
	// will trigger an exception on the server:
	let hiddenRatingField =
		formEl.querySelector(`:scope input[name='post[rating]'][type=hidden]`);
	if (hiddenRatingField !== null) {hiddenRatingField.disabled = true;};

	/* update property sheet: */

	let instigator = adapterInstigator;
	propertySheet.replaceAllProps(psRoot, origTerms, {propInfoSvc, instigator});
	propertySheet.acceptAll(psRoot, {propInfoSvc, instigator});
	propertySheet.replaceAllProps(psRoot, terms, {propInfoSvc, instigator});

	/* listen for changes to the proprty sheet: */
	psRoot.addEventListener(galk.updated,
		onPropertySheetUpdated.bind(null, tagsField), false);

	/* listen for changes to the tags field: */
	tagsField.addEventListener(`input`,
		prims.ensureDebouncedHdlr(tagsField, `input`,
			updatePropertySheetFromTagsField.bind(
				null, psRoot, tagsField, {propInfoSvc, instigator})), false);

	psRoot.addEventListener(galk.intent.saveAll,
		onPropertySheetSaveAllIntent.bind(null, formEl), false);
};

function findFieldById(formEl, id) {
	let field = formEl.querySelector(`:scope #${id}`);
	if (field instanceof HTMLInputElement
		|| field instanceof HTMLTextAreaElement)
	{
		return field;};
	return null;
};

function fieldValOrDefault(inputEl, elseVal = ``) {
	dbg && assert(inputEl === null
		|| inputEl instanceof HTMLInputElement
		|| inputEl instanceof HTMLTextAreaElement);
	dbg && assert.str(elseVal);

	if (inputEl === null) {return elseVal;};
	return inputEl.value;
};

function updatePropertySheetFromTagsField(
	psRoot, inputEl, {propInfoSvc, instigator})
{
	propertySheet.ensureEditing(psRoot);
	propertySheet.replaceAllProps(
		psRoot,
		tagExpression.parseTerms(
			fieldValOrDefault(inputEl)),
		{propInfoSvc, instigator});
};

function onPropertySheetUpdated(
	/* bound: */ fieldEl,
	/* event: */ {detail : {terms /* the change-set */, instigator}})
{
	if (instigator === adapterInstigator) {
		return; /* this update was triggered by `tagsField` input */};

	/* apply changes to the field element's contents: */
	assignTermsToTextRange(
		terms,
		fieldValOrDefault(fieldEl),
		(s, i, j) => fieldEl.setRangeText(s, i, j));
};

export function assignTermsToTextRange(terms, initialText, setRangeText) {
	let rawLen = initialText.length;
	let lenOffset = 0;

	for (let {term, changed, beginIndex, endIndex} of
		tagExpression.operateXpr(initialText, terms, normaliseTerm))
	{
		dbg && assert(beginIndex <= endIndex);
		if (!changed) {continue;};

		let origLen = endIndex - beginIndex;

		if (term === null || term.op === termOps.exclude) {
			if (origLen === 0) {
				/* nothing to do */
			} else {
				dbg && assert(origLen > 0);
				dbg && assert(beginIndex < rawLen);
				dbg && assert(endIndex <= rawLen);

				/* delete: */

				setRangeText(``,
					beginIndex + lenOffset,
					endIndex + lenOffset);

				lenOffset -= origLen;
			};

		} else {
			let s = tagExpression.tryFormatTerm(term);
			if (s === undefined) {
				/* ignore: */
				log.warn(`can't represent term as a wellformed tag expression`,
					term);

			} else if (beginIndex >= rawLen) {
				dbg && assert(origLen === 0);

				/* append: */

				if (beginIndex > rawLen) {
					s = ` `+s;};

				/* leave a space for subsequent terms */
				setRangeText(s+` `,
					rawLen + lenOffset,
					rawLen + lenOffset);

				lenOffset += s.length + 1;

			} else {
				/* replace: */

				if (endIndex < rawLen) {
					s += ` `;};

				setRangeText(s,
					beginIndex + lenOffset,
					endIndex + lenOffset);

				lenOffset += s.length - origLen;
			};
		};
	};
};

function onPropertySheetSaveAllIntent(
	/* bound: */ formEl,
	/* event: */ ev)
{
	dbg && log.debug(`onPropertySheetSaveAllIntent`);
	dbg && assert(formEl instanceof HTMLFormElement);
	formEl.submit();
};

/* -------------------------------------------------------------------------- */

/*





















































*/

/* -------------------------------------------------------------------------- */