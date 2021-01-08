/* -------------------------------------------------------------------------- */

'use strict';

import * as common from './common.js';
const {
	dbg,
	log,
	assert,
	GalkError,} = common;

/* -------------------------------------------------------------------------- */

dbg && assert(document instanceof HTMLDocument);

/* inspired by https://github.com/Freak613/stage0 */

const refPrefix = `@`;
const refSep = `-`;
const kPaths = Symbol(`refPaths`);
const kRefs = Symbol(`refNodes`);
const emptyAttrs = document.createElement(`p`).attributes;
/* careful about using this in reentrant functions: */
const treeWalker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);

export function createTemplate(s, opts) {
	let templ = createRawTemplate(s);
	return prepareTemplate(templ, opts);
};

export function createRawTemplate(s) {
	let templ = document.createElement(`template`);
	templ.innerHTML = s;
	return templ;
};

export function isPreparedTemplate(templ) {
	return (templ instanceof HTMLTemplateElement) && (kPaths in templ);
};

export function prepareTemplate(templ, opts) {
	/* `templ` should be a raw template;
	the node hierarchy within the template should not be modified once
	the template has been prepared */

	if (isPreparedTemplate(templ)) {
		throw new GalkError(`template already prepared`);};

	dbg && assert(templ instanceof HTMLTemplateElement);
	templ[kPaths] = traceTemplate(templ, opts);
	return templ;
};

export function instantiateTemplate(
	/* <template>: */ {content, [kPaths] : paths},
	{preserveTemplate = true} = {})
{
	dbg && assert(content instanceof DocumentFragment);
	dbg && assert.arr(paths);

	let frag;
	if (preserveTemplate) {
		/* leave template untouched so it can be instantiated again */
		frag = content.cloneNode(true);
	} else {
		/* remove the template's contents, leaving it empty */
		frag = document.createDocumentFragment();
		frag.appendChild(content);
	};

	let startNode = frag.firstChild;
	if (startNode !== null) {
		collectAndMemoiseRefs(paths, startNode);};

	return frag;
};

export function collectTemplateRefs({content, [kPaths] : paths}) {
	/* note that refs are not memoised when collected from a template */

	dbg && assert(content instanceof DocumentFragment);
	dbg && (paths === undefined || assert.arr(paths));

	if (paths === undefined) {
		/* unprepared template; trace refs without modifying any nodes: */
		paths = traceTemplate({content},
			{clearRefs : false, stripEmptyText : false});
	};

	let startNode = content.firstChild;
	if (startNode !== null) {
		return collectRefs(paths, startNode).refNodes;};

	return null;
};

export function cloneTemplate(templ) {
	/* note: the [kPaths] array will be cloned, but not the path objects
	themselves, which should be considered immutable */

	dbg && assert(templ instanceof HTMLTemplateElement);

	let clone = templ.cloneNode(true);
	if (kPaths in templ) {
		dbg && assert.arr(templ[kPaths]);
		clone[kPaths] = templ[kPaths].slice();
	};

	return clone;
};

function traceTemplate(
	/* <template>: */ {content},
	/* opts: */ {
		stripEmptyText = false,
		subTemplates = {},
		clearRefs = true,} = {})
{
	/* examples:

		element references:
			<span @category>…</span>
			note: attribute names are case-insensitive;
			kebab-case will be converted to camelCase

		attribute references:
			<span title='@tooltip'>

		text-node references:
			<span>@words</span>

	returns: [{name, offset, attrName} …]

	ref tokens in `content` will be cleared by default

	subtemplates may be either prepared <template> elements
	or raw subtemplate objects of the form {template, ...opts} */

	dbg && assert(content instanceof DocumentFragment);
	dbg && assert.bool(stripEmptyText);
	dbg && assert.obj(subTemplates);
	dbg && assert.bool(clearRefs);

	let paths = [];

	let node = content.firstChild;
	if (node === null) {
		return paths;};

	let offset = 0;
	treeWalker.currentNode = node;
	do {
		if (node instanceof HTMLElement) {
			let attrNames = node.getAttributeNames();
			for (let i = 0, n = attrNames.length; i < n; ++i) {
				let name = attrNames[i];
				if (name.charAt(0) === refPrefix) {
					/* element reference: */
					paths.push({
						name : refNameToIdentifier(name),
						offset,});
					offset = 0;

					if (clearRefs) {
						node.removeAttribute(name);};

				} else {
					let value = node.getAttribute(name);
					if (value.charAt(0) === refPrefix) {
						/* attribute reference: */
						paths.push({
							name : refNameToIdentifier(value),
							offset,
							attrName : name,});
						offset = 0;

						if (clearRefs) {
							node.setAttribute(name, ``);};
					};
				};
			};
		} else if (node instanceof Text) {
			let value = node.nodeValue.trim();
			if (value.charAt(0) === refPrefix) {
				/* text-node reference: */

				if (common.some(value, c =>
					common.codePointIsWhitespace(c.codePointAt(0))))
				{
					/* this often happens with adjacent text-node refs */
					throw new GalkError(
						`reference node "${value}" contains whitespace`);
				}

				let id = refNameToIdentifier(value);

				let subTempl = subTemplates[id];
				if (subTempl !== undefined) {
					dbg && assert(clearRefs,
						`can't trace subtemplates without clearing refs`);
					offset = traceSubTemplate(
						subTempl, id, offset, treeWalker, paths, node);

				} else {
					if (clearRefs) {
						node.nodeValue = ``;};
					paths.push({
						name : id,
						offset,});
					offset = 0;
				};

			} else if (value === ``
				&& stripEmptyText
				&& node.parentNode !== null)
			{
				if (treeWalker.previousNode() !== null) {
					--offset;};
				node.parentNode.removeChild(node);
			};
		};

		++offset;
		node = treeWalker.nextNode();
	} while (node !== null);

	return paths;
};

function traceSubTemplate(
	templ, name, offset, treeWalker, paths, placeholderNode)
{
	/* returns the new traversal offset after replacing placeholderNode
	with the template content */

	dbg && assert.str(name);
	dbg && assert(placeholderNode instanceof Node);

	if (!isPreparedTemplate(templ)) {
		/* assume it's a raw subtemplate, of the form {template, ...opts} */
		dbg && assert.obj(templ);
		dbg && assert(templ.template instanceof HTMLTemplateElement);

		/* save treeWalker's state to allow reentrancy: */
		let {currentNode} = treeWalker;
		templ = prepareTemplate(templ.template, templ);
		treeWalker.currentNode = currentNode;
	};

	let {content, [kPaths] : subPaths} = templ;
	dbg && assert.arr(paths);

	let frag = content.cloneNode(true);

	let node = frag.firstChild;
	if (node === null) {
		/* empty template */
		if (treeWalker.previousNode() !== null) {
			--offset;};
		placeholderNode.remove();
		return offset;
	};

	placeholderNode.before(frag);

	/* template content becomes the target of ref `name`: */
	paths.push({
		name,
		offset,
		paths : subPaths,});
	offset = 0;

	treeWalker.currentNode = node;
	/* advance the treewalker past the end of the subtemplate content: */
	while (node !== placeholderNode) {
		++offset;
		node = treeWalker.nextNode();
		dbg && assert(node !== null);
	};

	dbg && assert(treeWalker.currentNode === placeholderNode);
	if (treeWalker.previousNode() !== null) {
		--offset;};
	placeholderNode.remove();
	return offset;
};

export function refNameToIdentifier(name) {
	dbg && assert.str(name);
	dbg && assert(name[0] === refPrefix);

	let id = ``;
	for (let i = 1, n = name.length, afterSep = false; i < n; ++i) {
		let c = name[i];
		if (c === refSep) {
			afterSep = true;
		} else {
			if (afterSep) {
				afterSep = false;
				c = c.toUpperCase();
			};
			id += c;
		};
	};
	return id;
};

export function identifierToRefName(id) {
	dbg && assert.str(id);

	let name = refPrefix;
	for (let i = 0, n = id.length; i < n; ++i) {
		let c = id[i];
		let lower = c.toLowerCase();
		if (i > 0 && c !== lower) {
			name += refSep;};
		name += lower;
	};
	return name;
};

export function createRefNode(identifier) {
	dbg && assert.str(identifier);
	return document.createTextNode(identifierToRefName(identifier));
};

export function getRefs(startNode) {
	dbg && assert(startNode instanceof Node);

	if (startNode instanceof DocumentFragment) {
		startNode = startNode.firstChild;
		if (startNode === null) {
			return null;};
	};

	let refs = startNode[kRefs];
	if (typeof refs !== `object`) {
		return null;};

	return refs;
};

function collectAndMemoiseRefs(refPaths, startNode) {
	let {refNodes, subInstances} = collectRefs(refPaths, startNode);
	startNode[kRefs] = refNodes;

	for (let i = 0, n = subInstances.length; i < n; ++i) {
		let sub = subInstances[i];
		collectAndMemoiseRefs(sub.paths, sub.node);
	};
};

function collectRefs(refPaths, startNode) {
	dbg && assert.arr(refPaths);
	dbg && assert(startNode instanceof Node);

	let refNodes = {};
	let subInstances = [];

	let node = startNode;
	let attrs = null;
	treeWalker.currentNode = node;

	for (let i = 0, n = refPaths.length; i < n; ++i) {
		let {name, offset, attrName, paths : subPaths} = refPaths[i];
		dbg && assert.str(name);
		dbg && assert.int32(offset);

		if (offset > 0) {
			/* moving to different node - drop cached attribute map: */
			attrs = null;};

		while (--offset >= 0) {
			node = treeWalker.nextNode();};

		dbg && assert(node === null || node instanceof Node);

		if (attrName === undefined) {
			/* element or text-node reference: */
			refNodes[name] = node;

			if (subPaths !== undefined) {
				/* nested template: */
				subInstances.push({node, paths : subPaths});};

		} else {
			/* attribute reference: */

			if (attrs === null) {
				attrs =
					node instanceof HTMLElement
						? node.attributes
						: emptyAttrs;
			};
			dbg && assert(attrs instanceof NamedNodeMap);
			dbg && assert.str(attrName);

			refNodes[name] = attrs.getNamedItem(attrName);
		};
	};

	return {refNodes, subInstances};
};

/* -------------------------------------------------------------------------- */

/*





















































*/

/* -------------------------------------------------------------------------- */