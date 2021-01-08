/* -------------------------------------------------------------------------- */

'use strict';

import * as dom from './dom-templating.js';
import * as prims from './primitives.js';
import * as propertySheet from './property-sheet-booru.js';
import * as adapter from './property-sheet-form-adapter.js';
import * as propInfoSvc from './property-information-service-danbooru.js';
import * as common from './common.js';
const {
	dbg,
	galk,
	assert,
	log,
	GalkError,} = common;

/* -------------------------------------------------------------------------- */

/* run unittests: */
//import * as tests from './tests.js';
//if (dbg && !tests.runAll()) {
//	throw new GalkError(`test suite failed`);};

/* -------------------------------------------------------------------------- */

const doc = document;

if (!(doc instanceof HTMLDocument)) {
	throw new GalkError(`can't find "document" object`);};
if (doc.readyState === `loading`) {
	throw new GalkError(`content script loaded at incorrect readyState`);};

log(`gathering existing page elements ...`);

let editForm = doc.querySelector(`#edit #form`)
	|| doc.querySelector(`#edit-dialog #form`);
let tagList = doc.getElementById(`tag-list`); /* <ul> */
let sourceList = doc.getElementById(`post-info-source`); /* <ul> */
let searchBar = doc.querySelector(`#search-box #tags`);

dbg && log.debug(`page elements:`, {editForm, tagList, sourceList, searchBar});

/* integrate with danbooru's functions: */
let danbooruInst = (doc.defaultView || {}).Danbooru;
if (typeof danbooruInst === `object`) {
	common.assignOnAssertionFailure(
		onAssertionFailure.bind(null, danbooruInst));

	propInfoSvc.addEventListener(galk.serviceError,
		onServiceError.bind(null, danbooruInst), false);

	propInfoSvc.addEventListener(galk.serviceWarning,
		onServiceWarning.bind(null, danbooruInst), false);
};

let psRoot = null;
if (editForm !== null && tagList !== null) {
	log(`extracting tag attributes from tag-list element ...`);
	propInfoSvc.extractTagAttrsFromList(tagList);

	if (sourceList !== null) {
		log(`extracting source info from source-list element ...`);
		propInfoSvc.extractSourceInfoFromList(sourceList);
	};

	log(`initialising property sheet ...`);
	psRoot = dom.instantiateTemplate(
		propertySheet.createTemplate(), {preserveTemplate : false}).firstChild;
	propertySheet.initialise(psRoot, {propInfoSvc});

	/* prevent danbooru hotkey handlers interfereing with our own: */
	psRoot.addEventListener(`keydown`, ev => ev.stopPropagation(), false);
	psRoot.addEventListener(`keyup`, ev => ev.stopPropagation(), false);

	log(`binding property sheet with form-adapter ...`);
	adapter.bindSearchTermsField(psRoot, searchBar);
	adapter.bindForm(psRoot, editForm);

	log(`attaching to tag-list element ...`);
	tagList.parentElement.insertBefore(psRoot, tagList);
};

const errorMessageTemplate = dom.createTemplate(
	`<div>@type<!---->: <!---->@detail</div>`, // todo; note: must be a single containing element for innerHTML
	{stripEmptyText : true});
function instantiateErrorTemplate(type, msg) {
	let el = dom.instantiateTemplate(errorMessageTemplate).firstChild;
	let refs = dom.getRefs(el);
	refs.type.data = `${type}`;
	refs.detail.data = `${msg}`;
	return el;
};

function onServiceWarning(
	/* bound: */ danbooruInst,
	/* event: */ {type, detail})
{
	dbg && assert.str(detail);
	if (typeof danbooruInst.notice === `function`) {
		danbooruInst.notice(
			instantiateErrorTemplate(type, detail).innerHTML,
			false /* disappear after 6s */);
		/* .notice() expects a HTML string */
	};
};

function onServiceError(
	/* bound: */ danbooruInst,
	/* event: */ {type, detail})
{
	dbg && assert(detail instanceof Error);
	if (typeof danbooruInst.error === `function`) {
		danbooruInst.error(
			instantiateErrorTemplate(type, detail.toString()).innerHTML);
			/* .error() expects a HTML string */
	};
};

function onAssertionFailure(/* bound: */ danbooruInst) {
	common.assignOnAssertionFailure(() => {});

	if (psRoot !== null) {
		/* set PS to read-only: */
		try {
			propertySheet.finishEditing(psRoot, true);
		} catch (_) {};
	};

	if (typeof danbooruInst.error === `function`) {
		danbooruInst.error(
			instantiateErrorTemplate(`Fatal error`,
				`Assertion failed; check the browser console for details. `+
				`Property sheet is now read-only `+
				`to avoid undefined behaviour.`).innerHTML);
		/* .error() expects a HTML string */
	};
};

/* -------------------------------------------------------------------------- */

/*








































*/

/* -------------------------------------------------------------------------- */