/* -------------------------------------------------------------------------- */

'use strict';

import * as dom from './dom-templating.js';
import * as prims from './primitives.js';
import * as base from './property-sheet-base.js';
import * as tagExpression from './tag-expression.js';
const {normaliseTerm, normaliseAssignment, termOps} = tagExpression;
import * as common from './common.js';
const {
	dbg,
	galk,
	assert,
	GalkError,
	log,
	codePointIsWhitespace,} = common;

/* -------------------------------------------------------------------------- */

const utf8Enc = new TextEncoder();
function keyFor({kind, value}) {
	switch (kind) {
		case `` /* tag */ :
			return utf8Enc.encode(value);
			// potential for optimisation:
			// since tags only contain codepoints 33 ('!') to 126 ('~'),
			// a more compact tree would be produced by not outputting the full
			// 8 bits for each character
			// though we'd also need to cater for '\ufffd' (replacement char)

		case `source` :
			// todo: support multiple sources
			// nontrivial due to
			// (1) no correct algorithm for tokenising the source string
			// (2) preserving order of tokens; server doesn't treat it as a set.
			return Uint8Array.of();

		case `parent` : return Uint8Array.of(0);
		case `rating` : return Uint8Array.of(1);
		case `embedded` : return Uint8Array.of(2);

		default :
			return utf8Enc.encode(kind+tagExpression.kindSepChar+value);
	};
};

const selectKindConfigBase = {
	mode : `select`,
	createItem : createSelectItem,
	updateItem : updateSelectItem,
	bindItem : bindSelectItem,
	beginEditingItem : selectItemBeginEditing,
};

const tokensKindConfigBase = {
	mode : `tokens`,
	createItem : createTokensItem,
	updateItem : updateTokensItem,
	bindItem : bindTokensItem,
	beginEditingItem : tokensItemBeginEditing,
};

const config = {
	sections : [
		{kinds : [`` /* tag */],
			buttonGroup : sectionButtonGroupTemplate(`Tags`)},
		{kinds : [`source`],
			buttonGroup : sectionButtonGroupTemplate(`Sources`)},
		{kinds : [`parent`, `rating`, `embedded`],
			buttonGroup : sectionButtonGroupTemplate(`Settings`)},
		{kinds : [tagExpression.wildcardChar],
			buttonGroup : sectionButtonGroupTemplate(`Unrecognised`)},
	],

	kinds : {
		[`` /* tag */] : {
			...tokensKindConfigBase,
			bindItem : bindTagItem,
			updateItem : updateTagItem,
		},

		source : {
			...tokensKindConfigBase,
			updateItem : updateSourceItem,
		},

		parent : {
			...tokensKindConfigBase,
		},

		rating : {
			...selectKindConfigBase,
			options : [
				{value : `s`, name : `Safe`},
				{value : `q`, name : `Questionable`},
				{value : `e`, name : `Explicit`},],
		},

		embedded : {/* embed notes */
			...selectKindConfigBase,
			options : [
				{value : `false`, name : `No`},
				{value : `true`, name : `Yes`},],
		},
	},
};

function configForKind(k) {
	dbg && assert.obj(config.kinds);
	let c = config.kinds[k];
	if (c === undefined) {
		c = tokensKindConfigBase; /* default */};
	dbg && assert.obj(c);
	return c;
};

const headerButtonGroupTemplate = prims.createButtonGroupTemplate(
	{moreTabIndex : 0, moreLabel : `Post Properties`},
	{
		selectAll : {
			classes : [galk.selectBtn],
			label : `Select all`,
			tabIndex : 0,
			clickMode : `press`,},

		saveAll : {
			classes : [galk.saveBtn],
			label : `Save all`,
			tabIndex : 0,},

		resetAll : {
			classes : [galk.resetBtn],
			label : `Reset all`,
			tabIndex : 0,},

		/*config : {
			classes : [galk.configBtn],
			label : `Preferences…`,
			tabIndex : 0,
			clickMode : `release`,},*/

		about : {
			classes : [galk.helpBtn],
			label : `About…`,
			tabIndex : 0,
			clickMode : `release`,},
	});

function sectionButtonGroupTemplate(title) {
	dbg && assert.str(title);
	return prims.createButtonGroupTemplate(
		{moreTabIndex : 0, moreLabel : title},
		{
			selectAll : {
				classes : [galk.selectBtn],
				label : `Select section`,
				tabIndex : 0,
				clickMode : `press`,},

			help : {
				classes : [galk.wikiBtn],
				label : `Help`,
				tabIndex : 0,},

			deleteAll : {
				classes : [galk.deleteBtn],
				label : `Delete all`,
				tabIndex : 0,},
		});
};

export function createTemplate() {
	let {template, subTemplates} =
		base.createRawTemplate({
			classes : [galk.propertySheet.booru],
			sectionDefs : config.sections,
			headerButtonGroup : headerButtonGroupTemplate,
			sectionButtonGroup : sectionButtonGroupTemplate,});

	let {root} = dom.collectTemplateRefs(template);

	/* extend the base template by appending the side-panel as a subtemplate: */
	root.appendChild(dom.createRefNode(`sidepanel-placeholder`));
	root.appendChild(dom.createRefNode(`side-panel`));
	subTemplates.sidePanel = sidePanelTemplate;

	return dom.prepareTemplate(template,
		{stripEmptyText : true, subTemplates});
};

export function initialise(root, {propInfoSvc = null}) {
	dbg && assert.objOrNull(propInfoSvc);

	base.initialise(root);
	let {buttonGroup : rootBtnGrp, sidePanel} = dom.getRefs(root);

	prims.initialiseButtonGroup(rootBtnGrp, {surfaceCapacity : 3});

	for (let sect of base.allSections(root)) {
		let {buttonGroup : sectBtnGrp, addPropTextbox, propList} =
			dom.getRefs(sect);
		let kinds = base.getSectionKinds(sect);
		let kind = common.single(kinds);

		propList.classList.add(galk.propList.editable);

		prims.initialiseButtonGroup(sectBtnGrp, {
			surfaceCapacity : 2,
			order : [`selectAll`, `help`, `deleteAll`]});

		let btns = dom.getRefs(sectBtnGrp);

		btns.selectAll.addEventListener(galk.input,
			onSectionSelectAllIntent.bind(null, sect), false);

		btns.deleteAll.addEventListener(galk.input,
			onSectionDeleteAllIntent.bind(null, sect, propInfoSvc), false);

		addPropTextbox.addEventListener(`keydown`,
			onAddTagTextboxKeyDown.bind(null, root),
			true /* intercept before textbox `Enter` key handling */);

		if (kind === `` /* tag */) {
			/* group tags into categories: */
			propList.classList.add(galk.propList.categrouped);

			addPropTextbox.addEventListener(galk.selectionchange,
				onTokensTextboxSelect.bind(
					null, root, kind, propInfoSvc), false);

			//addPropTextbox.addEventListener(`focusout`,
			//	onAddTagTextboxFocusOut.bind(null, root), false);
		};

		assignHref(btns.help,
			kind !== undefined && kind !== tagExpression.wildcardChar
				? propInfoSvc.getPropWikiPageHref({kind, value : ``})
				: undefined);
	};

	root.addEventListener(galk.intent.addProp,
		onAddPropIntent.bind(null, propInfoSvc), false);

	root.addEventListener(`keydown`,
		onRootKeyDown.bind(null, propInfoSvc), false);

	root.addEventListener(galk.itemCreated,
		onPropItemCreated.bind(null, propInfoSvc), false);

	let btns = dom.getRefs(rootBtnGrp);

	btns.selectAll.addEventListener(galk.input,
		onSelectAllIntent.bind(null, root), false);

	btns.resetAll.addEventListener(galk.input,
		onResetAllIntent.bind(null, root, propInfoSvc), false);

	btns.saveAll.addEventListener(galk.input,
		onSaveAllIntent.bind(null, root), false);

	if (propInfoSvc !== null) {
		propInfoSvc.addEventListener(galk.propAttrsRetrieved,
			onPropAttrsRetrieved.bind(null, root, propInfoSvc), false);

		propInfoSvc.addEventListener(galk.propSummaryRetrieved,
			onPropSummaryRetrieved.bind(null, root, propInfoSvc), false);

		propInfoSvc.addEventListener(galk.autocompleteResults,
			onAutocmpltResults.bind(null, root, propInfoSvc), false);

		propInfoSvc.addEventListener(galk.propRelativesRetrieved,
			onPropRelativesRetrieved.bind(null, root, propInfoSvc), false);

		propInfoSvc.addEventListener(galk.userRelatedPropsRetrieved,
			onUserRelatedPropsRetrieved.bind(null, root, propInfoSvc), false);

		propInfoSvc.addEventListener(galk.sourceInfosRetrieved,
			onSourceInfosRetrieved.bind(null, root, propInfoSvc), false);
	};

	initialiseSidePanel(sidePanel, {propInfoSvc});
	toggleSidePanelOpen(sidePanel, true);

	return root;
};

export const ensureEditing = base.ensureEditing;

export const finishEditing = base.finishEditing;

// unused and unfinished:
//export function deleteAll(root, {propInfoSvc = null, instigator}) {
//	dbg && assert.objOrNull(propInfoSvc);
//
//	// todo: normaliseAssignment
//
//	let op = termOps.exclude;
//	let affected = base.operateAll(root, {
//		operate : ({term : {kind, value}, status, content}) =>
//			opAssignProp(
//				{root, propInfoSvc, searchOpByProp : null, instigator},
//				{status, content, term : {kind, value, op}}),
//		keyFor,});
//
//	onPropsAffected(root, affected, {propInfoSvc, instigator});
//};

export function replaceAllProps(root, terms, args) {
	let termMap = tagExpression.termMapFrom(
		common.map(terms, normaliseTerm));

	/* delete all props which don't appear in `terms`: */
	let unmentionedTerms = Array.from(
		common.map(
			common.filter(
				base.allProps(root),
				({status, kind, value}) =>
					status !== `deleted`
					&& common.getFromSubMap(termMap, kind, value)
						=== undefined),
			({kind, value}) =>
				({kind, value, op : termOps.exclude})));

	assignProps(root, common.chain(unmentionedTerms, terms), args);
};

export function assignProps(root, terms, {propInfoSvc = null, instigator}) {
	dbg && assert.objOrNull(propInfoSvc);
	dbg && assert.sequ(terms);

	let searchOpByProp = parseCachedSearchTerms(root);

	let affected = base.operateProps(root,
		common.map(terms, tagExpression.normaliseAssignment),
		{
			operate : opAssignProp.bind(null,
				{root, propInfoSvc, searchOpByProp, instigator}),
			keyFor,});

	onPropsAffected(root, affected, {propInfoSvc, instigator});
};

function opAssignProp(
	/* bound: */ {root, propInfoSvc, searchOpByProp, instigator},
	/* per-item: */ {term, status, content})
{
	/* note: `status` is the current status of the prop,
	before the assign operation takes place */

	let {op, kind, value} = term;
	let include = op !== termOps.exclude;

	if (content === null && include) {
		let kindCfg = configForKind(kind);
		let frag = kindCfg.createItem(
			{term, root, propInfoSvc, searchOpByProp, instigator});
		content = frag;

		kindCfg.updateItem({
			content : frag.firstChild,
			term, root, propInfoSvc, searchOpByProp, instigator});

	} else if (content !== null) {
		let kindCfg = configForKind(kind);
		kindCfg.updateItem(
			{content, term, root, propInfoSvc, searchOpByProp, instigator});
	};

	return {include, content};
};

function opUpdateProp(
	/* bound: */ {root, propInfoSvc, searchOpByProp, instigator},
	/* per-item: */ {term, status, content})
{
	let include = base.isPositiveStatus(status);
	if (content !== null) {
		/* opUpdateProp doesn't perform assignment; ignore term.op: */
		let op = opFromBool(include);
		if (tagExpression.termOp(term) !== op) {
			term = {op, kind : term.kind, value : term.value};};

		let kindCfg = configForKind(term.kind);
		kindCfg.updateItem(
			{content, term, root, propInfoSvc, searchOpByProp, instigator});
	};

	return {content, include};
};

function opFromStatus(s) {
	return opFromBool(base.isPositiveStatus(s));
};

function opFromBool(x) {
	return x ? termOps.include : termOps.exclude;
};

function onPropItemCreated(
	/* bound: */ propInfoSvc,
	/* event: */ {target : item, detail : term})
{
	dbg && assert(item instanceof HTMLLIElement);
	dbg && assert.obj(term);

	let kindCfg = configForKind(term.kind);
	let f = kindCfg.bindItem;
	if (f !== undefined) {
		f(item, {propInfoSvc});};
};

function bindPropItem(item) {
	dbg && assert(item instanceof HTMLLIElement);
	item.addEventListener(`keydown`, onPropItemKeyDown, false);
};

function onPropItemKeyDown(ev) {
	let {currentTarget : item} = ev;
	let handled = false;

	switch (ev.key) {
		case `F2` :
			if (!prims.anyModifierKeyActive(ev)) {
				/* edit the prop: */
				let root = base.getPropItemRoot(item);
				if (base.ensureEditing(root)) {
					propItemBeginEditing(root, item, true);};
				handled = true;
			};
			break;

		case `Escape` :
			if (!prims.anyModifierKeyActive(ev)) {
				/* focus the add-prop textbox: */
				let sect = base.getPropItemSection(item);
				if (sect !== null) {
					let {addPropTextbox} = dom.getRefs(sect);
					dbg && assert(addPropTextbox instanceof HTMLElement);
					dom.getRefs(addPropTextbox).content.focus();
					handled = true;

					// todo: what about sections where the textbox is hidden?
				};
			};
			break;
	};

	if (handled) {
		ev.preventDefault();
		ev.stopPropagation();
		ev.stopImmediatePropagation();
	};
};

function propItemBeginEditing(root, item, takeFocus) {
	let {kind} = item.dataset;
	let kindCfg = configForKind(kind);
	let f = kindCfg.beginEditingItem;
	if (f !== undefined) {
		f(root, item, takeFocus);};
};

export function acceptAll(root, {propInfoSvc = null, instigator}) {
	let affected = base.acceptAll(root, {keyFor,
		update : opUpdateProp.bind(null, {
			root,
			propInfoSvc,
			searchOpByProp : null,
			instigator,})});

	onPropsAffected(root, affected, {propInfoSvc, instigator});
};

export function resetAll(root, {propInfoSvc = null, instigator}) {
	let searchOpByProp = parseCachedSearchTerms(root);

	let affected = base.resetAll(root, {keyFor,
		update : opUpdateProp.bind(null, {
			root,
			propInfoSvc,
			searchOpByProp,
			instigator,})});

	onPropsAffected(root, affected, {propInfoSvc, instigator});
};

export function replaceAllSearchTerms(root,
	{terms /* [...{kind, value, op}] */, instigator})
{
	/* call when search terms are updated
	(e.g. after typing into the search bar) */

	let searchOpByProp = new Map(/* kind → value → op */);
	for (let t of terms) {
		dbg && assert.str(t.op);
		tagExpression.assignTermMap(searchOpByProp, normaliseTerm(t));
	};

	cacheSearchTerms(root, searchOpByProp);

	/* update propertysheet entries: */
	base.operateAll(root, {
		operate : opUpdateProp.bind(null, {
			root,
			propInfoSvc : null,
			searchOpByProp,
			instigator,}),
		keyFor,});
};

export function assignSearchTerms(root,
	{terms /* [...{kind, value, op}] */, instigator})
{
	terms = common.map(terms, normaliseTerm);
	/* call when specific search terms are changed
	(e.g. after clicking a `toggleSearch` button) */

	let searchOpByProp = parseCachedSearchTerms(root);
	for (let t of terms) {
		/* note: t.op may be `undefined` (absent) */
		if (t.op === undefined) {
			tagExpression.deleteFromTermMap(searchOpByProp, t);
		} else {
			tagExpression.assignTermMap(searchOpByProp, t);};
	};

	cacheSearchTerms(root, searchOpByProp);

	/* update propertysheet entries: */
	base.operateProps(root, terms, {
		operate : opUpdateProp.bind(null, {
			root,
			propInfoSvc : null,
			searchOpByProp,
			instigator,}),
		keyFor,});
};

function onPropsAffected(root, affectedProps, {instigator, propInfoSvc}) {
	let {sidePanel} = dom.getRefs(root);
	updateSidePanelPropStattrs(sidePanel,
		{statusByProp : affectedProps, propInfoSvc});

	/* galk.updated: `terms` is the change-set as a sequence of terms */
	root.dispatchEvent(new CustomEvent(galk.updated,
		{detail : {terms : affectedPropsAsTerms(affectedProps), instigator}}));
};

function affectedPropsAsTerms(affected /* Map(kind → value → status) */) {
	return common.chainFrom(Array.from(
		common.map(affected, ([kind, subMap]) =>
			common.map(subMap, ([value, status]) =>
				({kind, value, op : opFromStatus(status)})))));
};

function cacheSearchTerms(root, searchOpByProp) {
	/* search terms are cached in a root attribute
	for convenience when new props are added: */
	root.dataset.searchTerms =
		common.joinString(
			common.filter(
				common.map(
					tagExpression.iterateTermMap(searchOpByProp),
					t => {
						let s = tagExpression.tryFormatTerm(t);
						if (s === undefined) {
							log.warn(`can't represent property as `+
								`a wellformed tag expression`, t);};
						return s;
					}),
				s => s !== undefined /* ignore unformattable terms */),
			` ` /* separator */);
};

function parseCachedSearchTerms(root) {
	return tagExpression.termMapFrom(
		tagExpression.parseTerms(root.dataset.searchTerms || ``));
};

function dispatchAssignSearchTermIntent(root, term) {
	/* user is attempting to toggle the search button on a property;
	note: term.op may be '', '-' or `undefined` (absent) */
	dbg && tagExpression.assertTerm(term);
	root.dispatchEvent(new CustomEvent(
		galk.intent.assignSearchTerm, {detail : {term, instigator : root}}));
};

function onAddPropIntent(
	/* bound: */ propInfoSvc,
	/* event: */ ev)
{
	/* user entered an expression in the add-prop textbox */
	let {currentTarget : root, detail : {kinds, expression}} = ev;
	dbg && assert.sequ(kinds);
	dbg && assert.str(expression);

	// todo:
	// the add-prop textbox in sections other than 'tags' wouldn't behave well
	// since the input will be parsed as a tag expression
	// (e.g. you'd need to enter `source:'http:/…'`)
	// `kinds` is a list of kinds present in this section, which could
	// potentially be used to select a different parsing method.
	// for now, the add-prop textbox is hidden in all sections other than the
	// 'tags' section.

	let terms = tagExpression.parseTerms(expression);

	if (common.some(terms) /* need at least one term */
		&& base.ensureEditing(root))
	{
		assignProps(root,
			terms,
			{propInfoSvc, instigator : root});
	} else {
		ev.preventDefault();};
};

function onSelectAllIntent(
	/* bound: */ root,
	/* event: */ ev)
{
	dbg && assert(root instanceof HTMLElement);

	/* select everything inside all sections: */
	prims.assignSelectionNodesContents(root.ownerDocument,
		common.map(base.allSections(root),
			sect => dom.getRefs(sect).propList));
};

function onResetAllIntent(
	/* bound: */ root, propInfoSvc,
	/* event: */ ev)
{
	dbg && assert(root instanceof HTMLElement);
	dbg && assert.objOrNull(propInfoSvc);

	if (base.isEditing(root)) {
		resetAll(root, {propInfoSvc, instigator : root});
		base.finishEditing(root);
	};
};

function onSaveAllIntent(
	/* bound: */ root,
	/* event: */ ev)
{
	dbg && assert(root instanceof HTMLElement);
	if (base.isEditing(root)) {
		root.dispatchEvent(new CustomEvent(galk.intent.saveAll));};
};

function onSectionSelectAllIntent(
	/* bound: */ sect,
	/* event: */ ev)
{
	dbg && assert(sect instanceof HTMLElement);

	/* select everything inside the section: */
	let {propList} = dom.getRefs(sect);
	prims.assignSelectionNodesContents(sect.ownerDocument, [propList]);
};

function onSectionDeleteAllIntent(
	/* bound: */ sect, propInfoSvc,
	/* event: */ ev)
{
	dbg && assert(sect instanceof HTMLElement);
	let root = base.getSectionRoot(sect);

	/* delete all props within the section: */
	if (base.ensureEditing(root)) {
		let op = termOps.exclude;
		assignProps(root,
			common.map(base.sectionProps(sect),
				({kind, value}) => ({kind, value, op})),
			{propInfoSvc, instigator : root});
	};
};

function onRootKeyDown(
	/* bound: */ propInfoSvc,
	/* event: */ ev)
{
	let {currentTarget : root} = ev;

	if (ev.key === ` ` && ev.shiftKey
		&& prims.singleModifierKeyActive(ev))
	{
		/* shift+space toggles the sidepanel open/closed */
		let {sidePanel} = dom.getRefs(root);
		if (toggleSidePanelOpen(sidePanel)) {
			/* now open */
			updateSidePanelFocusedProp(sidePanel, {
				kind : sidePanel.dataset.kind,
				value : sidePanel.dataset.value,
				propInfoSvc,});
		};
		ev.preventDefault();

	} else if (ev.key === `Enter` && ev.ctrlKey
		&& prims.singleModifierKeyActive(ev))
	{
		/* ctrl+enter submits */
		onSaveAllIntent(root);
		ev.preventDefault();
	};
};

function onPropAttrsRetrieved(
	/* bound: */ root, propInfoSvc,
	/* event: */ {detail : {kind, entries /* [...[value, attrs]] */}})
{
	// assumes values are normalised
	dbg && assert.objOrNull(propInfoSvc);
	dbg && assert.arr(entries);
	dbg && entries.every(x => assert.arr(x));

	if (entries.length !== 0) {
		let {sidePanel} = dom.getRefs(root);
		updateSidePanelPropStattrs(sidePanel, {kind, propInfoSvc});
	};

	/* update propertysheet entries: */
	base.operateProps(
		root,
		/* terms: */ common.map(entries, ([value, _]) => ({kind, value})),
		{
			operate : opUpdateProp.bind(null, {
				root,
				propInfoSvc,
				searchOpByProp : null,
				instigator : onPropAttrsRetrieved,}),
			keyFor,});
};

function onSourceInfosRetrieved(
	/* bound: */ root, propInfoSvc,
	/* event: */ {detail : entries /* [...[src, info]] */})
{
	dbg && assert.objOrNull(propInfoSvc);
	dbg && assert.sequ(entries);

	/* update propertysheet entries: */
	base.operateProps(
		root,
		/* terms: */ common.map(entries, ([src, _]) =>
			({kind : `source`, value : src})),
		{
			operate : opUpdateProp.bind(null, {
				root,
				propInfoSvc,
				searchOpByProp : null,
				instigator : onSourceInfosRetrieved,}),
			keyFor,});
};

function updateItemSearchOp(
	{term, item, searchOpByProp})
{
	if (item !== null && searchOpByProp !== null) {
		assignDatasetAttr(item.dataset, `searchOp`,
			tagExpression.getFromTermMap(searchOpByProp, term));
	};
};

function tryGetPropItemFromContent(content) {
	dbg && assert(content instanceof HTMLElement);
	let item = content.parentElement;
	dbg && (item === null || assert(item instanceof HTMLLIElement));
	return item;
};

/* --- select item --- */

const selectItemContentTemplate = dom.createTemplate(
	`<span class='${galk.propContent}'>
		<span class='${galk.propLabelHiddenAffix}'>@hidden-prefix</span>
		<fieldset @option-buttons class='${galk.optionBtns}'></fieldset>
	</span>`,
	{stripEmptyText : true});

const optionButtonTemplate = dom.createTemplate(
	`<input @input type='radio' value='' name=''>
	<label @label-elem>@btn</label>`,
	{
		stripEmptyText : true,
		subTemplates : {
			btn : prims.createButtonTemplate({
				clickMode : `release`,})},});

function createSelectItem({term, root, propInfoSvc}) {
	let itemContentFrag =
		dom.instantiateTemplate(selectItemContentTemplate);

	let refs = dom.getRefs(itemContentFrag);
	let {optionButtons} = refs;
	dbg && assert(optionButtons instanceof HTMLFieldSetElement);

	let radioGroupId = galk.select[prims.randomHexString()];
	let {options} = configForKind(term.kind);
	for (let opt of options) {
		let frag = dom.instantiateTemplate(optionButtonTemplate);

		let {input, labelElem, btn} = dom.getRefs(frag);
		let {labelText} = dom.getRefs(btn);

		input.name = radioGroupId;
		input.value = opt.value;

		let radioOptionId = galk.select.option[prims.randomHexString()];
		input.id = radioOptionId;
		labelElem.htmlFor = radioOptionId;

		labelText.data = opt.name.slice(0, 4);
		/* if truncated, show full name in tooltip: */
		if (opt.name.length > 4) {
			labelElem.title = opt.name;};

		prims.initialiseButton(btn);
		btn.removeAttribute(`tabindex`); /* buttons not focusable */

		optionButtons.appendChild(frag);
	};

	/* events from hidden <input> elements: */
	optionButtons.addEventListener(`input`,
		onSelectItemInput.bind(null,
			{root, kind : term.kind, propInfoSvc}), false);

	return itemContentFrag;
};

function bindSelectItem(item, {propInfoSvc}) {
	bindPropItem(item);
	item.addEventListener(galk.itemFocusIn, onSelectItemFocusIn, false);
};

function updateSelectItem(
	{content, term, root, propInfoSvc, searchOpByProp})
{
	let refs = dom.getRefs(content);
	let {optionButtons} = refs;

	for (let el of optionButtons.elements) {
		el.checked = el.value === term.value;};

	updateItemSearchOp(
		{term, item : tryGetPropItemFromContent(content), searchOpByProp});
	updateSelectItemHiddenAffixes(refs, {term});
};

function updateSelectItemHiddenAffixes(refs, {term : {op, kind, value}}) {
	/* add invisible decorations to make it suitable for selecting+copying */

	// todo: move this logic to tag-expression.js
	refs.hiddenPrefix.data =
		(op||``)+kind+tagExpression.kindSepChar
		+(value || tagExpression.emptyPlaceholder);
};

function onSelectItemInput(
	/* bound: */ {root, kind, propInfoSvc},
	/* event: */ {currentTarget : optionButtons})
{
	dbg && assert.str(kind);
	dbg && assert(root instanceof HTMLElement);
	dbg && assert(optionButtons instanceof HTMLFieldSetElement);

	let selected = common.first(
		optionButtons.elements,
		x => x.checked,
		optionButtons.elements.item(0));

	if (base.ensureEditing(root)) {
		assignProps(root,
			[{kind, value : selected.value}],
			{propInfoSvc, instigator : root});
	};
};

function onSelectItemFocusIn({target : item}) {
	let root = base.getPropItemRoot(item);
	selectItemBeginEditing(root, item, true);
};

function selectItemBeginEditing(root, item, takeFocus) {
	if (!takeFocus) {return;};

	let {optionButtons} = dom.getRefs(item.firstChild);

	let focusTarget = common.first(
		optionButtons.elements,
		x => x.checked,
		optionButtons.elements.item(0));

	if (focusTarget !== null) {
		focusTarget.focus();};
};

/* --- tokens item --- */

const tokensItemContentTemplate = dom.createTemplate(
	/* wrapper element allows use of ::before/::after in css: */
	`<span class='${galk.propContent}'>
		@button-group<!---->
		<span class='${galk.propLabel}'>
			<span class='${galk.propLabelHiddenAffix}'>@hidden-prefix</span>
			<a @value-label class='${galk.propLabelFormatted}'></a>
			@value-textbox<!---->
			<span class='${galk.propLabelHiddenAffix}'>@hidden-suffix</span>
		</span>
		<small @side-label class='${galk.propSideLabel}'></small>
		@loading-btn<!---->
	</span>
	@sidepanel-placeholder`,
	{
		stripEmptyText : true,
		subTemplates : {
			valueTextbox : prims.textboxTemplate,
			loadingBtn : prims.createButtonTemplate(
				{classes : [galk.loadingBtn]}),
			buttonGroup : prims.createButtonGroupTemplate(
				{classes : [galk.propCtrls]},
				{
					toggleSearch : {
						classes : [galk.toggleSchBtn],
						label : `Toggle search term`,
						clickMode : `press`,},

					copyRaw : {
						classes : [galk.copyBtn],
						label : `Copy raw`,
						// `mousedown` handling is deferred by queueMicrotask
						// which causes document.execCommand to fail
						// so use `click` events instead:
						clickMode : `release`},

					// todo
					//copyFormatted : {
					//	classes : [galk.copyBtn],
					//	label : `Copy`,
					//	clickMode : `release`},

					edit : {classes : [galk.editBtn], label : `Edit`,
						clickMode : `press`,
						/* required to ensure .focus() works reliably:  */
						suppressDefaultInputEvents : true,},

					delete : {classes : [galk.deleteBtn], label : `Delete`,},

					gotoLink : {classes : [galk.gotoLinkBtn], label : `Go to`,},

					wikiLink : {classes : [galk.wikiBtn], label : `Wiki`,},

					/*setCategArtist : {
						classes : [galk.configBtn, galk.categBtn],
						label : `Artist:`,
						clickMode : `release`,},
					setCategCopyright : {
					setCategCharacter : {
					setCategSpecies : {
					setCategMeta : {
					setCategGeneral : {*/
				}),
		},
	});

function createTokensItem({term, root, propInfoSvc}) {
	dbg && assert.obj(term);
	dbg && assert.objOrNull(propInfoSvc);

	let itemContentFrag =
		dom.instantiateTemplate(tokensItemContentTemplate);
	let itemContent = itemContentFrag.firstChild;

	let refs = dom.getRefs(itemContentFrag);

	/* label: */

	let {valueTextbox} = refs;

	prims.initialiseTextbox(valueTextbox,
		{tabIndex : -1} /* ensure textbox isn't a tab target while hidden */);

	valueTextbox.addEventListener(galk.input,
		onItemTextboxInput.bind(null, term.kind, propInfoSvc), false);

	valueTextbox.addEventListener(galk.selectionchange,
		onTokensTextboxSelect.bind(null, root, term.kind, propInfoSvc), false);

	valueTextbox.addEventListener(`keydown`,
		onTokensItemTextboxKeyDown.bind(null, root, itemContent),
		true /* intercept before textbox 'Enter'-key handling */);

	/* buttons: */

	let {buttonGroup} = refs;
	prims.initialiseButtonGroup(buttonGroup);

	let grpBtns = dom.getRefs(buttonGroup);

	grpBtns.toggleSearch.addEventListener(galk.input,
		onToggleSearchBtnInput.bind(null, root, itemContent), false);

	grpBtns.edit.addEventListener(galk.input,
		onTokensItemEditBtnInput.bind(null, root, itemContent), false);

	grpBtns.delete.addEventListener(galk.input,
		onItemDeleteBtnInput.bind(null, root, itemContent, propInfoSvc), false);

	// todo
	//grpBtns.copyFormatted.addEventListener(galk.input,
	//	onItemCopyBtnInput.bind(null, ?), false);

	grpBtns.copyRaw.addEventListener(galk.input,
		onItemCopyBtnInput.bind(null, itemContent), false);

	return itemContentFrag;
};

function bindTokensItem(item, {propInfoSvc}) {
	bindPropItem(item);
	item.addEventListener(galk.itemFocusIn, onTokensItemFocusIn, false);
	item.addEventListener(galk.commit,
		onItemTextboxCommit.bind(null, propInfoSvc), true);
};

function updateTokensItem(
	{content, term, propInfoSvc, searchOpByProp})
{
	dbg && assert.objOrNull(propInfoSvc);
	dbg && assert.objOrNull(searchOpByProp);

	let refs = dom.getRefs(content);
	updateTokensItemLabel(refs, {term, propInfoSvc});
	updateTokensItemButtons(refs,
		{term, propInfoSvc, searchOpByProp});

	updateItemSearchOp(
		{term, item : tryGetPropItemFromContent(content), searchOpByProp});
};

function updateTokensItemButtons(
	/* refs: */ {buttonGroup},
	{term, propInfoSvc, searchOpByProp})
{
	prims.updateButtonGroup(buttonGroup, {
		surfaceCapacity : 4,
		order : [
			`toggleSearch`, `edit`, `delete`,
			`gotoLink`, `wikiLink`, `copyRaw`],});

	let btns = dom.getRefs(buttonGroup);

	prims.updateButton(btns.delete,
		{toggled : term.op === termOps.exclude});

	if (propInfoSvc !== null) {
		assignHref(btns.gotoLink, propInfoSvc.getPropGotoHref(term));
		assignHref(btns.wikiLink, propInfoSvc.getPropWikiPageHref(term));
	};

	if (searchOpByProp !== null) {
		let searchOp = tagExpression.getFromTermMap(searchOpByProp, term);
		prims.updateButton(btns.toggleSearch,
			{toggled : searchOp !== undefined});
	};
};

function updateTokensItemLabel(refs, {term, propInfoSvc}) {
	let {valueLabel, valueTextbox, hiddenPrefix, hiddenSuffix} = refs;
	let {kind, value, op} = term;

	if (valueLabel) {
		valueLabel.textContent = value || tagExpression.emptyPlaceholder;};

	if (valueTextbox) {
		assignTokensItemTextboxIfNotInteracting(valueTextbox, term);};

	{/* add invisible decorations to make it suitable for selecting+copying */
		let m = kind !== `` ? kind+tagExpression.kindSepChar : ``;

		// todo: this doesn't account for internal quotes at all
		let quote =
			kind !== `` && common.some(common.stringCodePoints(value),
				common.codePointIsWhitespace) ? `'` : ``;

		// todo: this also doesn't account for abbreviated source hrefs

		hiddenPrefix.data = op+m+quote;
		hiddenSuffix.data = quote;
	};

	updateTokensItemLabelHref(
		{valueLabel, valueTextbox},
		{term, propInfoSvc});
};

function updateTokensItemLabelHref(refs, {term, propInfoSvc}) {
	dbg && (term === null || tagExpression.assertTerm(term));
	if (propInfoSvc !== null) {
		let {valueLabel, valueTextbox} = refs;
		let href = term ? propInfoSvc.getPropGotoHref(term) : undefined;

		if (valueLabel) {
			assignHref(valueLabel, href);};

		if (valueTextbox) {
			let {content} = dom.getRefs(valueTextbox);
			// a bug in chrome causes textboxes to lose focus when href is
			// removed, so always keep the href attribute present;
			// see https://codepen.io/bipface/pen/vYXpqEY
			assignHref(content, href || ``);
		};
	};
};

function bindTagItem(item, {propInfoSvc}) {
	bindTokensItem(item, {propInfoSvc});

	/* the first call to updateTagItemAttrs (in updateTagItem)
	won't have any effect as `item` doesn't exist at that point,
	so we must update again now that we have `item`: */
	updateTagItemAttrs({
		term : item.dataset,
		item,
		propInfoSvc,
		instigator : base.getPropItemRoot(item),});

	item.addEventListener(galk.itemFocusIn,
		onTagItemFocusIn.bind(null, propInfoSvc), false);
	item.addEventListener(galk.itemFocusOut,
		onTagItemFocusOut, false);
};

function updateTagItem(
	{content, term, propInfoSvc, searchOpByProp, instigator})
{
	dbg && assert.objOrNull(propInfoSvc);
	dbg && assert.objOrNull(searchOpByProp);

	let refs = dom.getRefs(content);

	updateTokensItemButtons(refs, {term, propInfoSvc, searchOpByProp});

	updateTagValueLabel(refs.valueLabel, term.value);
	assignTokensItemTextboxIfNotInteracting(refs.valueTextbox, term);

	updateTokensItemLabelHref(refs, {term, propInfoSvc});

	updateTagItemAttrs({
		term, item : tryGetPropItemFromContent(content),
		propInfoSvc, instigator});

	updateItemSearchOp(
		{term, item : tryGetPropItemFromContent(content), searchOpByProp});
};

function updateTagItemAttrs({
	term : {kind, value},
	item,
	forceRequest = false,
	propInfoSvc = null,
	instigator,})
{
	dbg && assert.bool(forceRequest);
	dbg && assert.objOrNull(item);
	dbg && assert.objOrNull(propInfoSvc);

	if (item !== null && propInfoSvc !== null) {
		let result = propInfoSvc.getPropAttrs(kind, value, {
			fromCache : !forceRequest,
			/* guard against infinite loop: */
			fromSvr : instigator !== onPropAttrsRetrieved,});

		if (result === propInfoSvc.pendingSym) {
			item.setAttribute(`aria-busy`, `true`);
		} else {
			dbg && assert.objOrNull(result);
			updateTagItemFromAttrs(
				item, dom.getRefs(item.firstChild), result || {});
		};
	};
};

function updateTagItemFromAttrs(item, refs, attrs) {
	item.removeAttribute(`aria-busy`);

	assignDatasetAttr(item.dataset, `category`, attrs.category);

	let {postCount} = attrs;
	dbg && (postCount === undefined || assert.uint31(postCount));
	assignDatasetAttr(item.dataset, `postCount`,
		postCount !== undefined ? `${postCount}` : undefined);

	updatePostCountLabel(refs.sideLabel, postCount);
};

function updatePostCountLabel(el, postCount) {
	if (postCount !== undefined) {
		dbg && assert.int32(postCount) && postCount >= 0;

		let compact = formatPostCountCompact(postCount);
		el.textContent = compact;

		let exact = formatPostCountExact(`${postCount}`);
		if (compact === exact) {
			el.removeAttribute(`title`);
		} else {
			el.title = exact;};

	} else {
		el.textContent = ``;
		el.removeAttribute(`title`);
	};
};

function updateTagValueLabel(el, value) {
	dbg && assert(el instanceof HTMLElement);
	dbg && assert.str(value);

	el.classList.toggle(galk.shortValue, value.length < 4);

	for (let x; (x = el.firstChild) != null;) {
		el.removeChild(x);};

	for (let node of tagLabelSegmentNodes(el.ownerDocument, value)) {
		el.appendChild(node);};
};

//function bindSourceItem(?) {
	// todo: what happens to the sidepanel when focusing source?
	//item.addEventListener(galk.itemFocusIn,
	//	onSourceItemFocusIn.bind(null, propInfoSvc), false);
	//item.addEventListener(galk.itemFocusOut,
	//	onSourceItemFocusOut, false);
//};

function updateSourceItem(args) {
	updateTokensItem(args);
 	updateSourceItemLabel(dom.getRefs(args.content), args);
};

function updateSourceItemLabel(refs, {
	term : {value},
	status,
	forceRequest = false,
	propInfoSvc = null,
	instigator,})
{
	dbg && assert.str(value);
	dbg && assert.objOrNull(propInfoSvc);

	// todo ?:
	//updateTokensItemLabel(/* don't use default logic for valueLabel: */
	//	{...refs, valueLabel : undefined},
	//	{term : {kind : `source`, value}, status, propInfoSvc});

	if (propInfoSvc !== null) {
		let {valueLabel, buttonGroup} = refs;
		let btns = dom.getRefs(buttonGroup);

		let abbrev = undefined;
		let href = propInfoSvc.getPropGotoHref({kind : `source`, value});

		let info = propInfoSvc.getSourceInfo(value, {
			fromCache : !forceRequest,
			/* guard against infinite loop: */
			fromSvr : instigator !== onSourceInfosRetrieved,});

		if (info === null) {
			dbg && log.debug(`no info found for source "${value}"`);
		} else if (info === propInfoSvc.pendingSym) {
			dbg && log.debug(`info pending for source "${value}"...`);
			href = undefined;
		} else {
			dbg && assert.obj(info);
			if (info.pageHref !== undefined) {
				href = info.pageHref;
				dbg && log.debug(
					`have pageHref for source "${value}" → "${href}"`);
			} else {
				dbg && log.debug(`no pageHref found for source "${value}"`);};

			abbrev = info.abbrevHref;
		};

		assignHref(valueLabel, href);
		assignHref(btns.gotoLink, href);

		valueLabel.textContent =
			abbrev !== undefined ? abbrev :
			href !== undefined ? href :
			(value || tagExpression.emptyPlaceholder);
	};
};

function onItemInputExpression(root, {item, expression, cause, propInfoSvc}) {
	/* an expression has been entered into the item's textbox;
	returns true if the input was applied */

	dbg && assert([`explicit`, `implicit`].includes(cause));

	let {kind, value : oldValue, status} = item.dataset;
	let isDeleted = status === `deleted`;

	let newTerms = common.map(
		tagExpression.parseTerms(expression), normaliseAssignment);

	let changed = common.count(newTerms, 2) !== 1
		|| !tagExpression.termsEquiv(
			{kind, value : oldValue}, common.first(newTerms));

	if (!changed && isDeleted && cause === `implicit`) {
		/* don't implicitly un-delete properties */
		dbg && log.debug(`not un-deleting prop:`,
			{kind, value : oldValue, cause});
		return false;
	};

	if (!changed && !isDeleted) {
		/* nothing to do */
		dbg && log.debug(`prop value unchanged:`, {kind, value : oldValue});
		return true;
	};

	if (base.ensureEditing(root)) {
		assignProps(root,
			common.chain(
				[{op : termOps.exclude, kind, value : oldValue}],
				newTerms),
			{propInfoSvc, instigator : root})

		return true;
	};

	dbg && log.debug(`prop value input from item, but root can't be edited`);
	return false;
};

function onItemTextboxCommit(
	/* bound: */ propInfoSvc,
	/* event: */ {currentTarget : item, detail})
{
	let root = base.getPropItemRoot(item);
	if (root === null) {return;};

	let {valueTextbox} = dom.getRefs(item.firstChild);
	let {content} = dom.getRefs(valueTextbox);
	let xpr = content.textContent;
	let nextItem = item.nextElementSibling;

	dbg && log.debug(`prop item textbox commit event:`,
		{kind : item.dataset.kind, xpr, detail});

	if (!onItemInputExpression(root, {
		item,
		expression : xpr,
		cause : detail,
		propInfoSvc,}))
	{
		return;};

	if (detail === `explicit`) {
		/* prevent double event when focusing other elements: */
		prims.textboxSuppressNextImplicitCommit(valueTextbox);

		/* focus next item, or the section textbox if this is the last item: */
		if (nextItem !== null) {
			nextItem.focus();
		} else {
			let sect = base.getPropItemSection(item);
			if (sect !== null) {
				let {addPropTextbox} = dom.getRefs(sect);
				dbg && assert(addPropTextbox instanceof HTMLElement);
				dom.getRefs(addPropTextbox).content.focus();
			};
		};
	};
};

function onItemTextboxInput(
	/* bound: */ kind, propInfoSvc,
	/* event: */ {currentTarget : valueTextbox})
{
	dbg && assert.str(kind);
	/* assign href only while there's a single term in the textbox: */
	updateTokensItemLabelHref({valueTextbox}, {
		term : common.single(
			common.map(
				tagExpression.parseTerms(valueTextbox.textContent),
				normaliseAssignment),
			undefined, null),
		propInfoSvc});
};

function onTokensItemFocusIn({target : item, detail}) {
	let root = base.getPropItemRoot(item);
	if (root === null) {return;};

	let refs = dom.getRefs(item.firstChild);
	let origTgt = detail.originalTarget;
	dbg && assert(origTgt instanceof HTMLElement);

	/* set focus to the value label unless clicking a button: */
	let takeFocus = !refs.buttonGroup.contains(origTgt);
	dbg && log.debug(`onTokensItemFocusIn`, {takeFocus});

	if (base.isEditing(root)) {
		tokensItemBeginEditing(root, item, takeFocus);
	} else if (takeFocus) {
		focusTokensItem(root, refs);};
};

function onTokensItemTextboxKeyDown(
	/* bound: */ root, itemContent,
	/* event: */ ev)
{
	dbg && assert(root instanceof HTMLElement);
	let item = tryGetPropItemFromContent(itemContent);

	let {sidePanel} = dom.getRefs(root);
	if (item !== null && sidePanel.parentElement === itemContent.parentElement
		/* forward keydown events to attached sidepanel: */
		&& handleSidePanelKeyDownEvent(sidePanel, ev))
	{
		ev.preventDefault();
		ev.stopPropagation();
		ev.stopImmediatePropagation();
	};
};

function onToggleSearchBtnInput(
	/* bound: */ root, itemContent,
	/* event: */ {})
{
	dbg && assert(root instanceof HTMLElement);
	let item = tryGetPropItemFromContent(itemContent);
	if (item === null) {return;};

	let {kind, value, searchOp} = item.dataset;
	dbg && assert.str(kind);
	dbg && assert.str(value);

	/* on click, cycle through the sequence of available operators
	(`union` intentionally omitted): */
	let cycleOps = [undefined, termOps.include, termOps.exclude];
	let newOp = cycleOps[(cycleOps.indexOf(searchOp) + 1) % cycleOps.length];

	dispatchAssignSearchTermIntent(root, {kind, value, op : newOp});
};

function onTokensItemEditBtnInput(
	/* bound: */ root, itemContent,
	/* event: */ {})
{
	dbg && log.debug(`onTokensItemEditBtnInput`);
	dbg && assert(root instanceof HTMLElement);
	let item = tryGetPropItemFromContent(itemContent);
	if (item === null) {return;};

	if (base.ensureEditing(root)) {
		tokensItemContentBeginEditing(
			root,
			dom.getRefs(itemContent),
			item.dataset, /* term */
			true /* takeFocus */);
	};
};

function onItemDeleteBtnInput(
	/* bound: */ root, itemContent, propInfoSvc,
	/* event: */ {})
{
	dbg && assert(root instanceof HTMLElement);
	let item = tryGetPropItemFromContent(itemContent);
	if (item === null) {return;};

	if (base.ensureEditing(root)) {
		/* toggle deletion: */
		let {status, value, kind} = item.dataset;
		assignProps(root,
			[{kind, value, op : opFromBool(!base.isPositiveStatus(status))}],
			{propInfoSvc, instigator : root});
	};
};

function onItemCopyBtnInput(
	/* bound: */ itemContent,
	/* event: */ {})
{
	let refs = dom.getRefs(itemContent);
	let doc = itemContent.ownerDocument;
	prims.assignSelectionNodesContents(
		doc, [refs.valueLabel, refs.valueTextbox]);
	prims.tryCopySelectionToClipboard(doc);
};

function focusTokensItem(root, /* refs: */ {valueLabel, valueTextbox}) {
	if (base.isEditing(root)) {
		let {content} = dom.getRefs(valueTextbox);
		content.focus();
		/* select value textbox contents: */
		prims.assignSelectionNodesContents(
			content.ownerDocument, [content]);
	} else {
		valueLabel.focus();};
};

function tokensItemBeginEditing(root, item, takeFocus) {
	dbg && log.debug(`tokensItemBeginEditing`);
	dbg && assert(item instanceof HTMLElement);

	let itemRefs = dom.getRefs(item.firstChild);
	tokensItemContentBeginEditing(
		root, itemRefs, item.dataset /* term */, takeFocus);
};

function tokensItemContentBeginEditing(root, refs, term, takeFocus) {
	dbg && log.debug(`tokensItemContentBeginEditing`);
	dbg && assert.obj(refs);
	dbg && assert.bool(takeFocus);

	assignTokensItemTextboxIfNotInteracting(refs.valueTextbox, term);

	if (takeFocus) {
		focusTokensItem(root, refs);};
};

function assignTokensItemTextboxIfNotInteracting(textbox, term) {
	dbg && assert(textbox instanceof HTMLElement);
	tagExpression.assertTerm(term);

	let {content} = dom.getRefs(textbox);
	dbg && assert(content instanceof HTMLElement);

	/* don't update textbox if user might be editing it: */
	let sel = prims.getSelection(content.ownerDocument);
	if (sel === null || !sel.containsNode(content, true)) {
		let {kind, value} = term; /* without op */
		content.textContent = tagExpression.tryFormatTerm({kind, value}) || ``;
	};
};

function onTagItemFocusIn(
	/* bound: */ propInfoSvc,
	/* event: */ {target : item, detail})
{
	let root = base.getPropItemRoot(item);
	if (root === null) {return;};

	let {sidePanel} = dom.getRefs(root);
	if (sidePanel.parentElement !== item) {
		let {sidepanelPlaceholder, valueTextbox} = dom.getRefs(item.firstChild);

		/* move the sidepanel into this item: */
		sidepanelPlaceholder.after(sidePanel);
		dbg && log.debug(`side-panel claimed by:`, item);

		let {kind, value} = item.dataset;
		updateSidePanelFocusedProp(sidePanel, {
			kind,
			value,
			partial : partialFromSelectionAnalysis(
				analyseTokensTextboxSelection(dom.getRefs(valueTextbox))),
			propInfoSvc,});
	};
};

function onTagItemFocusOut({target : item, detail}) {
	let root = base.getPropItemRoot(item);
	if (root === null) {return;};

	let {sidePanel} = dom.getRefs(root);
	if (sidePanel.parentElement === item) {
		releaseSidePanel(root, sidePanel);};
};

function onTokensTextboxSelect(
	/* bound: */ root, kind, propInfoSvc,
	/* event: */ {target : textbox})
{
	let selAnalysis = analyseTokensTextboxSelection(dom.getRefs(textbox));

	let {sidePanel} = dom.getRefs(root);
	updateSidePanelFocusedProp(sidePanel, {
		kind,
		value : selAnalysis !== null ? selAnalysis.token : undefined,
		partial : partialFromSelectionAnalysis(selAnalysis),
		propInfoSvc,});
};

//function onAddTagTextboxFocusOut(
//	/* bound: */ root,
//	/* event: */ ev)
//{
//
//};

function onAddTagTextboxKeyDown(
	/* bound: */ root,
	/* event: */ ev)
{
	dbg && assert(root instanceof HTMLElement);

	let {sidePanel} = dom.getRefs(root);
	if (sidePanelIsAtRoot(root, sidePanel)) {
		if (handleSidePanelKeyDownEvent(sidePanel, ev)) {
			ev.preventDefault();
			ev.stopPropagation();
			ev.stopImmediatePropagation();
		};
	};
};

/* --- side-panel --- */

const sidePanelInfoRawTemplate = dom.createRawTemplate(
	`<div class='${galk.sidePanel.subPanel} ${galk.sidePanel.info}'>
		<header>@title</header>
		@loading-btn
		<div @content tabindex='-1'
			class='${galk.sidePanel.content}`
				+` ${galk.sidePanel.infoContent}'></div>
	</div>`);
	/* can't use <details> because it doesn't support display:flex */
	/* tabindex='-1' is needed because `overflow-y:` makes it focusable */

function createSidePanelInfoTemplate({
	classes = [], label, description} = {})
{
	let templ = dom.cloneTemplate(sidePanelInfoRawTemplate);

	templ.content.firstChild.classList.add(...classes);

	return dom.prepareTemplate(templ, {
		stripEmptyText : true,
		subTemplates : {
			title : prims.createButtonTemplate({
				label, description, classes : [galk.wikiBtn]}),
			loadingBtn : prims.createButtonTemplate(
				{classes : [galk.loadingBtn]}),
		},
	});
};

const sidePanelListRawTemplate = dom.createRawTemplate(
	`<details class='${galk.sidePanel.subPanel}'>
		<summary tabindex='-1'>@title</summary>
		@loading-btn
		<ul @list class='${galk.sidePanel.content} ${galk.sidePanel.list}`
			+` ${galk.propList}'></ul>
	</details>`);

function createSidePanelListTemplate({
	classes = [], dataset = {}, label, description} = {})
{
	let templ = dom.cloneTemplate(sidePanelListRawTemplate);

	let el = templ.content.firstChild;
	el.classList.add(...classes);
	for (let [k, v] of Object.entries(dataset)) {
		el.dataset[k] = v;};

	return dom.prepareTemplate(templ, {
		stripEmptyText : true,
		subTemplates : {
			title : prims.createButtonTemplate(
				{label, description}),
			loadingBtn : prims.createButtonTemplate(
				{classes : [galk.loadingBtn]}),
		},
	});
};

const tagSuggestionTemplate = dom.createTemplate(
	`<li @item>
		<span class='${galk.propContent}'>
			<a @value-btn class='${galk.propLabel} ${galk.btn}'
				role='button' tabindex='-1' aria-selected='false'
				data-click-mode='release'
				data-suppress-default-input-events='true'>
				<span @value-label class='${galk.propLabelFormatted}'></span>
				<span @antecedent-label
					class='${galk.propLabelFormatted} ${galk.propAntcdtLabel}'>
				</span>
				<small @side-label class='${galk.propSideLabel}'></small>
			</a>
			@button-group<!---->
		</span>
	</li>`,
	{
		stripEmptyText : true,
		subTemplates : {
			buttonGroup : prims.createButtonGroupTemplate(
				{classes : [galk.propCtrls]},
				{
					wikiLink : {
						classes : [galk.wikiBtn],
						label : `Wiki`,
						suppressDefaultInputEvents : true,},

					toggleSearch : {
						classes : [galk.toggleSchBtn],
						label : `Toggle search term`,
						clickMode : `press`,},

					gotoLink : {
						classes : [galk.gotoLinkBtn],
						label : `Go to`,},

					copyRaw : {
						classes : [galk.copyBtn],
						label : `Copy raw`,
						// `mousedown` handling is deferred by queueMicrotask
						// which causes document.execCommand to fail
						// so use `click` events instead:
						clickMode : `release`},

					// todo
					//copyFormatted : {
					//	classes : [galk.copyBtn],
					//	label : `Copy`,
					//	clickMode : `release`},
				}),
		},
	});

const sidePanelTemplate = dom.createTemplate(
	`<dialog class='${galk.sidePanel} ${galk.menu}'>
		<div class='${galk.sidePanel.upper}'>
			@button-group<!---->
			@summary-panel<!---->
			@source-panel<!---->
			@autocmpl-panel<!---->
		</div>
		<div class='${galk.sidePanel.lower}'>
			@rels-panel-mixed<!---->
			@rels-panel-wiki<!---->
			@rels-panel-gen<!---->
			@rels-panel-ar<!---->
			@rels-panel-ch<!---->
			@rels-panel-co<!---->
			@rels-panel-frequ<!---->
			@rels-panel-recent<!---->
			@rels-panel-transl<!---->
		</div>
	</dialog>`,
	{
		stripEmptyText : true,
		subTemplates : {
			buttonGroup : prims.createButtonGroupTemplate(
				{classes : []},
				{
					close : {classes : [galk.closeBtn], label : `Close`,},
					expandW : {classes : [galk.expandBtn], label : `Expand`,},
				}),

			summaryPanel : createSidePanelInfoTemplate({
				classes : [galk.panel.summary]}),

			sourcePanel : createSidePanelInfoTemplate({
				classes : [galk.panel.source]}),

			autocmplPanel : createSidePanelListTemplate({
				classes : [galk.menu.autocmpl]}),

			relsPanelMixed : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				dataset : {category : ``},
				label : `Related`,
				description : `Related tags`}),

			relsPanelWiki : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				dataset : {category : `wiki`},
				label : `In\u00a0wiki`, /* nbsp */
				description : `Related tags (in wiki page)`}),

			relsPanelGen : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				dataset : {category : `general`},
				label : `General`,
				description : `Related general tags`}),

			relsPanelAr : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				dataset : {category : `artist`},
				label : `Artists`,
				description : `Related artist tags`}),

			relsPanelCh : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				dataset : {category : `character`},
				label : `Chars`,
				description : `Related character tags`}),

			relsPanelCo : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				dataset : {category : `copyright`},
				label : `Copyr's`,
				description : `Related copyright tags`}),

			relsPanelFrequ : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				label : `Frequ'`,
				description : `Frequent tags`}),

			relsPanelRecent : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				label : `Recent`,
				description : `Recent tags`}),

			relsPanelTransl : createSidePanelListTemplate({
				classes : [galk.menu.rels],
				label : `Transl'd`,
				description : `Translated tags`}),
		},
	});

function initialiseSidePanel(sidePanel, {propInfoSvc = null}) {
	dbg && assert(sidePanel instanceof HTMLElement);

	let refs = dom.getRefs(sidePanel);
	prims.initialiseButtonGroup(refs.buttonGroup, {surfaceCapacity : 3});

	let btns = dom.getRefs(refs.buttonGroup);
	btns.close.addEventListener(galk.input,
		toggleSidePanelOpen.bind(null, sidePanel, false), false);

	btns.expandW.addEventListener(galk.input, () => {
		sidePanel.style.setProperty(`--width-mul`,
			((sidePanel.style.getPropertyValue('--width-mul')|0) || 1) + 1);
	}, false);

	sidePanel.addEventListener(`toggle`,
		onRelsListToggle.bind(null, sidePanel, propInfoSvc), true);

	sidePanel.addEventListener(`focusin`, onSidePanelFocusIn, false);

	sidePanel.addEventListener(`keydown`, onSidePanelKeyDown, false);

	for (let panel of getRelsPanels(refs)) {
		/* this wouldn't be necessary, except in chrome for some reason
		an <a> inside a <summary> will consume the mouseclick and prevent the
		<details> from being toggled, even if the <a> has no href attribute;
		see: https://codepen.io/bipface/pen/eYdVvBq */

		let {title} = dom.getRefs(panel);
		dbg && assert(title instanceof HTMLAnchorElement);
		prims.initialiseButton(title);

		title.addEventListener(`click`, ev => {
			/* prevent the <details> from toggling automatically: */
			ev.preventDefault();}, false);

		title.addEventListener(galk.input, () => {
			panel.open = !panel.open;}, false);
	};
};

function toggleSidePanelOpen(sidePanel, open = undefined) {
	if (!sidePanel.toggleAttribute(`open`, open)) {
		/* now closed; clear ephemeral styles: */
		sidePanel.removeAttribute(`style`);
		return false;
	};
	return true;
};

function releaseSidePanel(root, sidePanel) {
	dbg && assert(root instanceof HTMLElement);
	dbg && assert(sidePanel instanceof HTMLElement);

	if (sidePanelIsAtRoot(root, sidePanel)) {
		return;};

	/* remove the side-panel from its current parent, and if it's still
	orphaned at the next tick, insert it back into the root: */

	sidePanel.remove();

	common.queueMicrotask(
		reclaimSidePanel.bind(null, root, sidePanel));
};

function sidePanelIsAtRoot(root, sidePanel) {
	let {sidepanelPlaceholder} = dom.getRefs(root);
	return sidePanel.parentElement === sidepanelPlaceholder.parentElement;
};

function reclaimSidePanel(root, sidePanel) {
	/* insert the orphan side-panel back into the root: */
	if (!sidePanel.isConnected) {
		let {sidepanelPlaceholder} = dom.getRefs(root);
		sidepanelPlaceholder.after(sidePanel);
		dbg && log.debug(`side-panel reclaimed by root`);
	};
};

function getSidePanelRoot(sidePanel) {
	/* the sidepanel only has two possible parents: root and propItem */

	if (sidePanel instanceof HTMLElement) {
		let p = sidePanel.parentElement;

		if (p instanceof HTMLLIElement) {
			/* parent is propItem */
			return base.getPropItemRoot(p);};

		if (p instanceof HTMLElement
			&& p.classList.contains(galk.propertySheet))
		{
			/* parent is root */
			return p;};
	};

	return null;
};

function updateSidePanelFocusedProp(sidePanel, {
	kind = undefined, /* focused property kind, if any */
	value = undefined, /* focused property value, if any */
	partial = ``, /* uncommitted value in focused textbox */
	propInfoSvc = null,})
{
	dbg && (kind === undefined || assert.str(kind));
	dbg && (value === undefined || assert.str(value));
	dbg && assert.str(partial);
	dbg && assert.objOrNull(propInfoSvc);

	resetSidePanelVirtualFocus(sidePanel);

	{
		/* update dataset even when closed
		so the panel can be updated once re-opened: */
		let ds = sidePanel.dataset;
		if (kind === undefined) {delete ds.kind;} else {ds.kind = kind;};
		if (value === undefined) {delete ds.value;} else {ds.value = value;};
	};

	if (!sidePanel.hasAttribute(`open`)) {
		return;};

	let refs = dom.getRefs(sidePanel);

	updateAutocmplPanel(refs.autocmplPanel,
		{sidePanel, kind, partial, propInfoSvc});

	updateSummaryPanel(refs.summaryPanel, {
		kind, propInfoSvc,
		/* don't fetch summaries while autocmpl is open: */
		value : refs.autocmplPanel.open ? undefined : value,});

	let openCategPanels = common.filter(getRelsPanels(refs),
		p => p.open && `category` in p.dataset);

	if (propInfoSvc !== null && kind !== undefined && value !== undefined) {
		let xs = common.map(openCategPanels, p =>
			[p, propInfoSvc.getPropRelatives(kind, value, p.dataset.category,
				{fromCache : true, fromSvr : false})]);

		/* close panels without cached data: */
		assignRelsPanels(
			common.map(
				common.filter(xs, ([_, data]) => data === null),
				([p, _]) => [p, []]),
			{open : false, sidePanel, propInfoSvc});

		/* update panels with cached data: */
		openCategPanels = common.filter(xs, ([_, data]) => data !== null);
		assignRelsPanels(openCategPanels, {sidePanel, propInfoSvc});

	} else {
		/* close all category-rel panels: */
		assignRelsPanels(common.map(openCategPanels, p => [p, []]),
			{open : false, sidePanel, propInfoSvc});
		openCategPanels = [];
	};

	updateDefaultRelPanels(refs, {
		sidePanel,
		open : common.some(openCategPanels) ? undefined : true,
		userId : common.tryParseUint31(document.body.dataset.currentUserId), // todo
		currentTime : new Date,
		sources : [],
		propInfoSvc,});

	//updateSourcePanel(
	//	refs.sourcePanel, {
	//		propInfoSvc,
			// todo});
};

function updateSidePanelPropStattrs(sidePanel,
	{statusByProp = new Map(/* kind → val → status */), propInfoSvc})
{
	dbg && assert.obj(statusByProp);
	let refs = dom.getRefs(sidePanel);

	for (let p of common.chain([refs.autocmplPanel], getRelsPanels(refs))) {
		let {list} = dom.getRefs(p);
		for (let x = list.firstChild; x !== null; x = x.nextSibling) {
			updateTagSuggestionItemStattrs(x, {statusByProp, propInfoSvc});};
	};
};

function assignTagSuggestionLists(
	dataByListElem, /* Map(<ul> → [...{value, antecedent}] or pendingSym) */
	{sidePanel, root /* optional */, propInfoSvc})
{
	dbg && assert(sidePanel instanceof HTMLElement);
	dbg && common.every(dataByListElem, ([el, xs]) =>
		typeof xs === `symbol` || common.every(xs, x => assert.obj(x)));

	let statusByProp = new Map();

	if (root === undefined) {
		root = getSidePanelRoot(sidePanel);};

	if (root !== null) {
		let terms = common.chainFrom(Array.from(
			common.map(dataByListElem,
				([el, xs]) =>
					(typeof xs) === `symbol` /* pendingSym */
						? []
						: common.map(xs, ({value}) =>
							({kind : `` /* tag */, value})))));

		for (let {kind, value, status} of
			base.getProps(root, terms, {keyFor}))
		{
			common.ensureSubMap(statusByProp, kind).set(value, status || ``);};
	};

	for (let [listEl, data] of dataByListElem) {
		if ((typeof data) === `symbol` /* pendingSym */) {
			;
		} else {
			prims.assignList(listEl, data,
				assignTagSuggestionItem.bind(null,
					sidePanel, statusByProp, propInfoSvc));
		};
	};
};

function assignTagSuggestionItem(
	/* bound: */ sidePanel, statusByProp, propInfoSvc,
	/* params: */ item, {value, antecedent})
{
	dbg && assert.objOrNull(propInfoSvc);
	dbg && (item === null || assert(item instanceof HTMLElement));
	dbg && assert.str(value);
	dbg && (antecedent === undefined || assert.str(antecedent));

	if (item === null) {
		item = dom.instantiateTemplate(tagSuggestionTemplate).firstChild;

		let {buttonGroup, valueBtn} = dom.getRefs(item);
		prims.initialiseButton(valueBtn);

		valueBtn.addEventListener(galk.input,
			onTagSuggestionValueBtnInput.bind(
				null, sidePanel, item, propInfoSvc), false);

		let btns = dom.getRefs(buttonGroup);
		prims.initialiseButtonGroup(buttonGroup, {surfaceCapacity : 2});

		btns.wikiLink.addEventListener(galk.input,
			onTagSuggestionWikiBtnInput.bind(
				null, sidePanel, item, propInfoSvc), false);

		btns.copyRaw.addEventListener(galk.input,
			onTagSuggestionCopyBtnInput.bind(null, item), false);
	};

	let ds = item.dataset;
	ds.value = value;
	assignDatasetAttr(ds, `antecedent`, antecedent);

	let refs = dom.getRefs(item);
	let {valueBtn, valueLabel, antecedentLabel, sideLabel, buttonGroup} = refs;
	let btns = dom.getRefs(buttonGroup);

	updateTagValueLabel(valueLabel, value);
	updateTagValueLabel(antecedentLabel,
		antecedent !== undefined ? `(← ${antecedent})` : ``);

	assignHref(valueBtn, propInfoSvc !== null
		? propInfoSvc.getPropGotoHref({kind : `` /* tag */, value}) : undefined);
	assignHref(btns.wikiLink, propInfoSvc !== null
		? propInfoSvc.getPropWikiPageHref({kind : `` /* tag */, value}) : undefined);
	assignHref(btns.gotoLink, propInfoSvc !== null
		? propInfoSvc.getPropGotoHref({kind : `` /* tag */, value}) : undefined);

	updateTagSuggestionItemStattrs(item, {statusByProp, propInfoSvc});

	return item;
};

function updateTagSuggestionItemStattrs(item,
	{statusByProp /* Map(kind → value → status) */, propInfoSvc})
{
	dbg && assert(item instanceof HTMLElement);
	dbg && assert.objOrNull(propInfoSvc);

	let ds = item.dataset;
	let {value} = ds;

	if (propInfoSvc !== null) {
		/* fetch cached attributes: */
		let attrs = propInfoSvc.getPropAttrs(`` /* tag */, value, {
			fromCache : true, fromSvr : false,}) || {};
		dbg && assert.obj(attrs);

		updateTagItemFromAttrs(item, dom.getRefs(item), attrs);
	};

	/* reflect current property state: */
	let s = common.getFromSubMap(statusByProp, `` /* tag */, value);
	if (s !== undefined) {
		dbg && assert.str(s);
		ds.status = s;
	};
};

function onTagSuggestionValueBtnInput(
	/* bound: */ sidePanel, item, propInfoSvc,
	/* event: */ ev)
{
	dbg && log.debug(`onTagSuggestionValueBtnInput, ${item.dataset.value}`);
	/* toggle property when chosen from the suggestion lists: */

	let root = getSidePanelRoot(sidePanel);
	if (root === null) {return;};

	let {value, kind, status} = item.dataset;
	dbg && tagExpression.assertTerm({kind : `` /* tag */, value});

	if (base.ensureEditing(root)) {
		let op = opFromBool(!base.isPositiveStatus(status));

		beforeTagSuggestionAction(sidePanel, {
			op, panel : getSidePanelListItemContainingPanel(item)});

		assignProps(root, [{kind : `` /* tag */, value, op}],
			{propInfoSvc, instigator : root});
	};
};

function onTagSuggestionWikiBtnInput(
	/* bound: */ sidePanel, item, propInfoSvc,
	/* event: */ {})
{
	// todo
	// force show summary panel with selected tag
	dbg && log.debug(`onTagSuggestionWikiBtnInput, ${item.dataset.value}`);
};

function onTagSuggestionCopyBtnInput(
	/* bound: */ item,
	/* event: */ {})
{
	let {valueLabel} = dom.getRefs(item);
	let doc = item.ownerDocument;
	prims.assignSelectionNodesContents(doc, [valueLabel]);
	prims.tryCopySelectionToClipboard(doc);
};

function onSidePanelKeyDown(ev) {
	let {currentTarget : sidePanel} = ev;
	if (handleSidePanelKeyDownEvent(sidePanel, ev)) {
		ev.preventDefault();
		ev.stopPropagation();
		ev.stopImmediatePropagation();
	};
};

function beforeTagSuggestionAction(sidePanel, {op, panel}) {
	let {autocmplPanel} = dom.getRefs(sidePanel);
	let doc = sidePanel.ownerDocument;
	if (op === termOps.include
		&& panel === autocmplPanel
		&& doc instanceof HTMLDocument)
	{
		/* before an 'add' from the autocomplete list
		clear the focused textbox: */
		let a = doc.activeElement;
		if (a !== null) {
			let textbox = a.closest(prims.textboxQuery);
			if (textbox !== null) {
				let {content} = dom.getRefs(textbox);
				content.textContent = ``;
				prims.commitTextbox(textbox, `explicit`);
			};
		};
	};
};

/* --- sidepanel focus --- */

const sidePanelVirtualFocusableQuery = `.${galk.btn}[aria-selected]`;
const sidePanelVirtualFocusedQuery = `.${galk.btn}[aria-selected='true']`;

function onSidePanelFocusIn({currentTarget : sidePanel, relatedTarget}) {
	if (!sidePanel.contains(relatedTarget)) {
		dbg && log.debug(`focus changing from outside sidePanel to within it`);
		/* virtual focus doesn't apply when the panel has real focus: */
		resetSidePanelVirtualFocus(sidePanel);
	};
};

function handleSidePanelKeyDownEvent(sidePanel, ev) {
	/* returns: (bool) whether event was consumed;
		caller is responsible for invoking .preventDefault() */

	if (!sidePanel.hasAttribute(`open`)) {
		//dbg && log.debug(
		//	`keydown event ("${ev.key}") ignored by sidepanel (closed)`);
		return false;
	};

	switch (ev.key) {
		case `ArrowDown` :
			if (!prims.anyModifierKeyActive(ev)) {
				onSidePanelArrowKeyDown(sidePanel, `down`);
				return true;
			};
		case `ArrowUp` :
			if (!prims.anyModifierKeyActive(ev)) {
				onSidePanelArrowKeyDown(sidePanel, `up`);
				return true;
			};
		case `Enter` :
			if (!prims.anyModifierKeyActive(ev)) {
				let {node, virtual} = getSidePanelFocus(sidePanel);
				if (node !== null) {
					/* avoid double-triggering galk.input events: */
					if (virtual) {
						dbg && log.debug(`redirecting sidepanel keydown ev `+
							`("${ev.key}") to focusable elem:`, node);
						node.dispatchEvent(
							new KeyboardEvent(ev.type,
								{key : ev.key, bubbles : false}));
					} else {
						dbg && log.debug(
							`sidepanel consuming keydown event ("${ev.key}") `+
							`without virtual focus`);
					};
					/* consume event if any part of the sidepanel has focus: */
					return true;
				};
			};
		case `Escape` :
			if (!prims.anyModifierKeyActive(ev)) {
				return resetSidePanelVirtualFocus(sidePanel);
				/* event is only consumed if the panel actually had focus */
			};
	};

	//dbg && log.debug(`keydown event ("${ev.key}") ignored by sidepanel `+
	//	`(unrecognised key combination)`);
	return false;
};

function onSidePanelArrowKeyDown(sidePanel, dir) {
	let curr = getSidePanelFocus(sidePanel);
	let next = getNextSidePanelFocus(sidePanel,
		{dir, node : curr.node, virtual : (curr.node ? curr.virtual : true)});
	if (next.node !== null) {
		assignSidePanelFocus(sidePanel, curr, next);
	} else {
		dbg && log.debug(`sidepanel next focus could not be determined; `+
			`current focus:`, curr);};
};

function getNextSidePanelFocus(sidePanel, {node : focused, virtual, dir}) {
	dbg && assert([`up`, `down`].includes(dir));

	let nextItem = null;
	if (focused === null) {
		/* default focus: first autocomplete item */
		let {autocmplPanel} = dom.getRefs(sidePanel);
		if (!autocmplPanel.open) {
			return {node : null};};

		let {list} = dom.getRefs(autocmplPanel);
		nextItem = dir === `down`
			? list.firstElementChild
			: list.lastElementChild;

	} else {
		let item = getContainingSidePanelListItem(focused);
		if (item === null) {
			return {node : null};};
		dbg && assert(item.parentElement);

		nextItem = dir === `down`
			? (item.nextElementSibling
				|| item.parentElement.firstElementChild)
			: (item.previousElementSibling
				|| item.parentElement.lastElementChild);
		/* lists are circular */
	};

	return {
		node : (nextItem
			? nextItem.querySelector(`:scope `+sidePanelVirtualFocusableQuery)
			: null),
		virtual,};
};

function assignSidePanelFocus(sidePanel, currFocus, newFocus) {
	let {node : cn, virtual : cv} = currFocus;
	let {node : nn, virtual : nv} = newFocus;

	dbg && (cn === null || assert(cn instanceof HTMLElement));
	dbg && (cv === undefined || assert.bool(cv));
	dbg && assert(nn instanceof HTMLElement);
	dbg && (nv === undefined || assert.bool(nv));

	if (nn === cn && nv === cv) {
		dbg && log.debug(`sidepanel focus unchanged`, currFocus);
		return;
	};

	if (cn !== null && cv) {
		setVirtualSelAttr(cn, false);};

	if (nv) {
		if (cn !== null && !cv) {
			cn.blur();};
		setVirtualSelAttr(nn, true);
	} else {
		nn.focus();};

	dbg && log.debug(`sidepanel focus moved from:`, currFocus, `to:`, newFocus);
};

function getSidePanelFocus(sidePanel) {
	let doc = sidePanel.ownerDocument;
	if (!doc) {
		return {node : null};};

	let node = doc.activeElement;
	if (sidePanel.contains(node)) {
		return {node, virtual : false};};

	node = sidePanel.querySelector(`:scope `+sidePanelVirtualFocusedQuery);
	if (node !== null) {
		return {node, virtual : true};};

	return {node : null};
};

function resetSidePanelVirtualFocus(sidePanel) {
	let any = false;
	for (let el of sidePanel.querySelectorAll(
		`:scope `+sidePanelVirtualFocusedQuery))
	{
		if (getVirtualSelAttr(el)) {
			setVirtualSelAttr(el, false);
			any = true;
		};
	};
	return any;
};

const sidePanelListItemQuery = `.${galk.sidePanel.list} > li`;
function getContainingSidePanelListItem(node) {
	return (node instanceof HTMLElement
		? node.closest(sidePanelListItemQuery)
		: null);
};

function getSidePanelListItemContainingPanel(item) {
	if (item instanceof HTMLElement) {
		let list = item.parentElement;
		if (list !== null) {
			let panel = list.parentElement;
			if (panel instanceof HTMLDetailsElement) {
				return panel;};
		};
	};
	return null;
};

function setVirtualSelAttr(el, sel) {
	dbg && assert.bool(sel);
	dbg && assert(el.hasAttribute(`aria-selected`));
	el.setAttribute(`aria-selected`, sel ? `true` : `false`);
};

function getVirtualSelAttr(el) {
	return el.getAttribute(`aria-selected`) === `true`;
};

/* --- autocomplete panel --- */

function updateAutocmplPanel(panel, {
	sidePanel,
	kind,
	partial = ``,
	propInfoSvc = null,})
{
	let {dataset} = panel;
	if (dataset.kind !== kind || dataset.partial !== partial) {
		/* autocmpl list needs to be updated for the current partial */

		let results = null;
		if (propInfoSvc !== null
			&& kind !== undefined
			&& partial !== ``)
		{
			results = propInfoSvc.requestPropAutocompleteValues(kind, partial);
		};

		assignAutocmplPanel(panel, {
			sidePanel,
			kind,
			partial,
			results,
			propInfoSvc,
			dataset,});
	};
};

function assignAutocmplPanel(panel, {
	sidePanel,
	kind,
	partial = ``,
	results = null, /* sequ|pendingSym|null */
	propInfoSvc = null,
	dataset = panel.dataset,})
{
	dbg && log.debug(`assignAutocmplPanel`, {partial, results});

	dbg && assert(panel instanceof HTMLDetailsElement);
	dbg && assert(sidePanel instanceof HTMLElement);
	dbg && (kind === undefined || assert.str(kind));
	dbg && assert.str(partial);
	dbg && assert.objOrNull(propInfoSvc);
	dbg && (results === null || typeof results === `symbol`
		|| assert.sequ(results));

	if (kind === undefined
		|| partial === ``
		|| propInfoSvc === null)
	{
		/* hide autocomplete: */
		delete dataset.kind;
		delete dataset.partial;
		panel.removeAttribute(`aria-busy`);
		panel.open = false;

	} else {
		dataset.kind = kind;
		dataset.partial = partial;

		if (results === propInfoSvc.pendingSym) {
			panel.setAttribute(`aria-busy`, `true`);
		} else {
			panel.removeAttribute(`aria-busy`);

			let {list} = dom.getRefs(panel);
			assignTagSuggestionLists(
				[[list, results || []]], {sidePanel, propInfoSvc});
		};

		panel.open = true;
	};
};

function onAutocmpltResults(
	/* bound: */ root, propInfoSvc,
	/* event: */ {detail : {kind, partial, results}})
{
	dbg && assert.objOrNull(propInfoSvc);
	dbg && assert.str(partial);
	dbg && results.every(assert.obj);

	let {sidePanel} = dom.getRefs(root);
	let {autocmplPanel} = dom.getRefs(sidePanel);

	let {dataset} = autocmplPanel;
	if (dataset.kind !== kind || dataset.partial !== partial) {
		/* these results aren't for the current partial */
		return;
	};

	assignAutocmplPanel(autocmplPanel, {
		sidePanel,
		kind,
		partial,
		results,
		propInfoSvc,
		dataset,});
};

/* --- summary panel --- */

function updateSummaryPanel(panel, {
	kind,
	value,
	propInfoSvc = null,})
{
	let {dataset} = panel;
	if (dataset.kind !== kind || dataset.value !== value) {
		/* summary menu needs to be updated for the current property */

		let summary = ``;
		if (propInfoSvc !== null
			&& kind !== undefined
			&& value !== undefined)
		{
			summary = propInfoSvc.getPropSummary(kind, value);
		};

		assignSummaryPanel(panel, {
			kind,
			value,
			summary,
			propInfoSvc,
			dataset,});
	};
};

function assignSummaryPanel(panel, {
	kind,
	value,
	summary, /* string|pendingSym */
	propInfoSvc = null,
	dataset = panel.dataset,})
{
	dbg && assert(panel instanceof HTMLElement);
	dbg && (kind === undefined || assert.str(kind));
	dbg && (value === undefined || assert.str(value));
	dbg && (typeof summary === `symbol` || assert.str(summary));
	dbg && assert.objOrNull(propInfoSvc);

	if (kind === undefined
		|| value === undefined
		|| propInfoSvc === null)
	{
		delete dataset.kind;
		delete dataset.value;
		panel.removeAttribute(`aria-busy`);

	} else {
		dataset.kind = kind;
		dataset.value = value;

		let {content, title} = dom.getRefs(panel);

		prims.updateButton(title, {label : value});
		assignHref(title, propInfoSvc.getPropWikiPageHref({kind, value}));

		if (summary === propInfoSvc.pendingSym) {
			panel.setAttribute(`aria-busy`, `true`);
		} else {
			panel.removeAttribute(`aria-busy`);
			content.textContent = summary;
		};
	};
};

function onPropSummaryRetrieved(
	/* bound: */ root, propInfoSvc,
	/* event: */ {detail : {kind, value, summary}})
{
	dbg && assert.objOrNull(propInfoSvc);
	dbg && assert.str(value);
	dbg && assert.str(summary);

	let {sidePanel} = dom.getRefs(root);
	let {summaryPanel} = dom.getRefs(sidePanel);

	let {dataset} = summaryPanel;
	if (dataset.kind !== kind || dataset.value !== value) {
		/* this result isn't for the current property */
		return;
	};

	assignSummaryPanel(summaryPanel, {
		kind,
		value,
		summary,
		propInfoSvc,});
};

/* --- related-tag menus --- */

function assignRelsPanels(
	dataByPanel, /* Map(<ul> → [...value] or pendingSym) */
	{
		open = undefined,
		sidePanel,
		propInfoSvc,})
{
	dbg && (open === undefined || assert.bool(open));
	dbg && common.every(dataByPanel, ([p, rels]) => {
		assert(p instanceof HTMLDetailsElement);
		typeof rels === `symbol` || common.every(rels, x => assert.str(x));});


	for (let [panel, data] of dataByPanel) {
		if (open !== undefined) {
			panel.open = open;};

		if (open !== false && propInfoSvc !== null
			&& data === propInfoSvc.pendingSym)
		{
			panel.setAttribute(`aria-busy`, `true`);
		} else {
			panel.removeAttribute(`aria-busy`);};
	};

	if (open === false) {
		return;};

	assignTagSuggestionLists(
		common.map(dataByPanel, ([p, rels]) => [
			dom.getRefs(p).list,
			Array.isArray(rels) ? common.map(rels, value => ({value})) : rels]),
		{sidePanel, propInfoSvc});
};

function onRelsListToggle(
	/* bound: */ sidePanel, propInfoSvc,
	/* event: */ ev)
{
	dbg && assert(sidePanel instanceof HTMLElement);
	dbg && assert.objOrNull(propInfoSvc);
	let {target} = ev;
	if (!(target instanceof HTMLDetailsElement)
		|| !target.open
		|| !target.classList.contains(galk.menu.rels)
		|| propInfoSvc === null)
	{
		return;};

	let {category} = target.dataset;
	if (category === undefined) {return;};

	let {kind, value} = sidePanel.dataset;
	if (kind === undefined || value === undefined) {
		ev.preventDefault();
		return;};

	/* close other rel panels: */
	for (let el of getRelsPanels(dom.getRefs(sidePanel))) {
		if (el !== target) {
			el.open = false;};};
	// todo: reconsider; user freq and recent lists should be open together

	let rels = propInfoSvc.getPropRelatives(kind, value, category);
	dbg && (rels === null
		|| rels === propInfoSvc.pendingSym
		|| assert.arr(rels));

	assignRelsPanels(
		[[target, rels]],
		{sidePanel, propInfoSvc});
};

function updateDefaultRelPanels(
	{relsPanelFrequ, relsPanelRecent, relsPanelTransl},
	{sidePanel, open, userId = undefined, currentTime, sources,
		propInfoSvc = null})
{
	dbg && (open === undefined || assert.bool(open));
	dbg && (userId === undefined || assert.uint31(userId));
	dbg && assert(currentTime instanceof Date && !isNaN(currentTime.getTime()));

	if (relsPanelFrequ.dataset.userId !== userId
		|| relsPanelRecent.dataset.userId !== userId)
	{
		let frequent = null;
		let recent = null;
		if (propInfoSvc !== null && userId !== undefined) {
			let results = propInfoSvc.getUserRelatedProps(
				`` /* tag */, userId, currentTime);
			if (results === propInfoSvc.pendingSym) {
				frequent = recent = results;
			} else {
				({frequent, recent} = (results || {}));};
		};

		relsPanelFrequ.dataset.userId = userId;
		relsPanelRecent.dataset.userId = userId;

		assignRelsPanels(
			[[relsPanelFrequ, frequent || []], [relsPanelRecent, recent || []]],
			{open, sidePanel, propInfoSvc});

	} else if (open !== undefined) {
		relsPanelFrequ.open = open;
		relsPanelRecent.open = open;
	};

	// todo
};

function onUserRelatedPropsRetrieved(
	/* bound: */ root, propInfoSvc,
	/* event: */ {detail : {kind, userId, frequent, recent}})
{
	dbg && assert.objOrNull(propInfoSvc);
	dbg && (frequent === null || assert.sequ(frequent));
	dbg && (recent === null || assert.sequ(recent));

	if (kind !== `` /* tag */) {return;};

	let {sidePanel} = dom.getRefs(root);
	let {relsPanelFrequ, relsPanelRecent} = dom.getRefs(sidePanel);

	if (userId !== common.tryParseUint31(relsPanelFrequ.dataset.userId || ``)) {
		frequent = null; /* these results aren't for the current user */};
	if (userId !== common.tryParseUint31(relsPanelRecent.dataset.userId ||``)) {
		recent = null; /* these results aren't for the current user */};

	let m = new Map();
	if (frequent !== null) {m.set(relsPanelFrequ, frequent || []);};
	if (recent !== null) {m.set(relsPanelRecent, recent || []);};
	assignRelsPanels(m, {sidePanel, propInfoSvc});
};

function onPropRelativesRetrieved(
	/* bound: */ root, propInfoSvc,
	/* event: */ {detail : {kind, value, relatives /* {category → value} */}})
{
	dbg && assert.objOrNull(propInfoSvc);
	dbg && assert.obj(relatives);
	if (kind !== `` /* tag */) {return;};

	let {sidePanel} = dom.getRefs(root);
	let panels = getRelsPanels(dom.getRefs(sidePanel));

	assignRelsPanels(
		common.map(
			common.filter(
				common.map(panels,
					panel => {
						let cat = panel.dataset.category;
						let rels = relatives[cat];
						dbg && (rels === undefined || assert.sequ(rels));
						return {panel, cat, rels};
					}),
				({cat, rels}) => cat !== undefined && rels !== undefined),
			({panel, cat, rels}) => [panel, rels]),
		{sidePanel, root, propInfoSvc});
};

function getRelsPanels(refs) {
	dbg && assert.obj(refs);
	return common.filter(Object.values(refs),
		el => (el instanceof HTMLDetailsElement
			&& el.classList.contains(galk.menu.rels)));
};

/* --- miscellaneous --- */

const tagWordSeparator = `_`;

function* tagLabelSegmentNodes(doc, v) {
	dbg && assert.str(v);
	dbg && assert(doc instanceof HTMLDocument);
	/* surround groups of consecutive underscores with <span>: */

	for (let i = 0, j = 0, n = v.length, inSep = false; j <= n; ++j) {
		if (j >= n || (v.charAt(j) === tagWordSeparator) !== inSep) {
			if (i !== j) {
				let text = v.slice(i, j);

				if (inSep) {
					let el = doc.createElement(`span`);
					el.classList.add(galk.tagSeparator);
					el.textContent = text;
					yield el;
				} else {
					yield doc.createTextNode(text);};

				i = j;
			};

			inSep = !inSep;
		};
	};
};

function formatPostCountCompact(c) {
	/* kludge until Intl.NumberFormat with 'compact' notation is supported */

	dbg && assert.int32(c) && c >= 0;
	let raw = `${c}`;

	if (c >= 10000) {
		return formatPostCountExact(raw.slice(0, -3))+`k`;};

	if (c >= 1000) {
		dbg && assert(raw.length === 4);

		if (raw[1] === `0`) {
			return raw[0]+`k`;};

		return raw[0]+common.numDecimalPoint+raw[1]+`k`;
	};

	return `${c}`;
};

function formatPostCountExact(raw) {
	/* separate integer into 3-digit groups */

	dbg && assert.str(raw);
	dbg && assert(/^\d+$/.test(raw));

	let s = ``;
	for (let n = raw.length, i = 0; i < n; i += 3) {
		if (s !== ``) {
			s = common.numGroupSeparator+s;};
		s = raw.slice(Math.max(0, n - i - 3), n - i)+s;
	};
	return s;
};

function assignHref(a, href) {
	dbg && assert(a instanceof HTMLAnchorElement);
	if (href === undefined) {
		a.removeAttribute(`href`);
	} else {
		a.href = href;};
};

function assignDatasetAttr(ds, k, v) {
	dbg && assert(ds instanceof DOMStringMap);
	dbg && assert.str(k);
	if (v === undefined) {
		delete ds[k];
	} else {
		dbg && assert.str(v);
		ds[k] = v;
	};
};

/* read this many codeunits behind, inside and ahead of current selection: */
const textboxAnalysisSubwindowLen = 100;

function analyseTokensTextboxSelection(/* refs: */ {content}) {
	/* searches for a token whose range entirely contains the current selection;
	otherwise returns null

	reads a window of text from the textbox, comprised of three subwindows:
	before the selection, within the selection, after the selection;
	each subwindow may be up to `textboxAnalysisSubwindowLen` codeunits long

	note that this is a naive tokenisation on whitespace - unlike the
	tag expression parser, which handles quoted values;
	however, danbooru's standard autocomplete control does not appear
	to be any smarter */

	dbg && assert(content instanceof HTMLElement);
	dbg && assert(content.dir === `` && content.ownerDocument.dir === ``,
		`selection analysis assumes right-to-left text direction`);

	let text = content.firstChild;
	if (text === null || text.nodeType !== Node.TEXT_NODE) {
		return null;};
	dbg && assert(text.nextSibling === null,
		`textbox content must be normalised`);

	let totalLen = text.length;
	if (totalLen === 0) {
		return null;};

	let sel = prims.getSelection(content.ownerDocument);
	if (sel === null || sel.rangeCount !== 1) {
		return null;};

	let selStart;
	let selEnd;

	let range = sel.getRangeAt(0);
	if (range.commonAncestorContainer === text) {
		selStart = range.startOffset;
		selEnd = range.endOffset;
	} else if (range.commonAncestorContainer === content) {
		selStart = range.startOffset === 1 ? totalLen : 0;
		selEnd = range.endOffset === 1 ? totalLen : 0;
	} else {
		/* selection is not entirely within the textbox */
		return null;}

	dbg && assert(selStart >= 0);
	dbg && assert(selEnd <= totalLen);

	if (selEnd - selStart > textboxAnalysisSubwindowLen) {
		/* selection is too large */
		return null;};

	let wndStart = Math.max(0, selStart - textboxAnalysisSubwindowLen);
	let wndEnd = Math.min(totalLen, selEnd + textboxAnalysisSubwindowLen);
	dbg && assert(wndStart < wndEnd);

	let wndVal = text.substringData(wndStart, wndEnd - wndStart);

	let wndSelStart = selStart - wndStart;
	let wndSelEnd = selEnd - wndStart;
	for (let i = wndSelStart; i < wndSelEnd; ++i) {
		if (codePointIsWhitespace(wndVal.charCodeAt(i))) {
			/* selection contains whitespace */
			return null;};
	};

	let tokStart = selStart;
	for (let i = wndSelStart - 1; i >= 0; --i) {
		if (codePointIsWhitespace(wndVal.charCodeAt(i))) {
			break;};
		--tokStart;
	};
	dbg && assert(wndStart <= tokStart && tokStart <= selStart);
	if (tokStart === wndStart && wndStart !== 0) {
		/* token extends too far beyond the start of the selection */
		return null;};

	let tokEnd = selEnd;
	for (let i = wndSelEnd, n = wndVal.length; i < n; ++i) {
		if (codePointIsWhitespace(wndVal.charCodeAt(i))) {
			break;};
		++tokEnd;
	};
	dbg && assert(selEnd <= tokEnd && tokEnd <= wndEnd);
	if (tokEnd === wndEnd && wndEnd !== totalLen) {
		/* token extends too far beyond the end of the selection */
		return null;};

	if (tokStart === tokEnd) {
		/* selection is surrounded by whitespace */
		return null;};

	return {
		selStart,
		selEnd,
		tokStart,
		tokEnd,
		token : wndVal.slice(tokStart - wndStart, tokEnd - wndStart),};
};

function partialFromSelectionAnalysis(x) {
	if (x !== null
		&& x.selStart === x.selEnd /* selection is collapsed */
		&& x.tokEnd === x.selStart /* cursor is at the end of the token */)
	{
		return x.token;};

	return ``;
};

/* -------------------------------------------------------------------------- */

/*





















































*/

/* -------------------------------------------------------------------------- */