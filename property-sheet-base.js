/* -------------------------------------------------------------------------- */

'use strict';

import * as dom from './dom-templating.js';
import * as prims from './primitives.js';
import * as tagExpression from './tag-expression.js';
import * as common from './common.js';
const {
	dbg,
	galk,
	GalkError,
	ensureSubMap,
	log,
	assert,} = common;

/* -------------------------------------------------------------------------- */

// todo: optimise acceptAll/resetAll/operateAll
// (operateSortedSetAll?)

const rootRawTemplate = dom.createRawTemplate(
	`<fieldset @root class='${galk} ${galk.propertySheet}'>
		<header>
			@button-group<!---->
			<span @title class='${galk.headerTitle}'></span>
		</header>
		@sections-placeholder
	</fieldset>`);

const sectionRawTemplate = dom.createRawTemplate(
	`<fieldset data-kinds='@kinds'>
		<legend>
			<!-- <span> wrapper to workaround <legend> styling limitations -->
			<span class='${galk.legendContent}'>
				@button-group<!---->
				<span @title class='${galk.sectionTitle}'></span>
			</span>
		</legend>
		<div class='${galk.addPropInput}'>
			@add-btn<!---->
			@add-prop-textbox<!---->
		</div>
		<ul @prop-list class='${galk.propList}'></ul>
	</fieldset>`);

const sectionSubTemplates = {
	addPropTextbox : prims.textboxTemplate,
	addBtn : prims.createButtonTemplate({
		classes : [galk.addBtn],
		label : `Add`,
		/* no tabindex because pressing enter on the textbox
		has the same effect as pressing the button */}),
};

const propTemplate = dom.createTemplate(
	`<li data-kind=''
		data-value=''
		data-value-orig=''
		data-status=''
		tabindex='0'></li>`,
	{stripEmptyText : true});

export function createRawTemplate({
	classes = [],
	sectionDefs,
	/* subTemplate: */ headerButtonGroup,})
{
	let templ = dom.cloneTemplate(rootRawTemplate);
	let doc = templ.ownerDocument
	let {root, sectionsPlaceholder} = dom.collectTemplateRefs(templ);

	root.classList.add(...classes);

	let subTemplates = {
		buttonGroup : headerButtonGroup};

	dbg && assert.sequ(sectionDefs);
	for (let [i, def] of common.enumerate(sectionDefs)) {
		subTemplates[`${i}`] = createRawSectionTemplate(def);
		root.insertBefore(dom.createRefNode(`${i}`), sectionsPlaceholder);
	};
	root.removeChild(sectionsPlaceholder);

	return {template : templ, subTemplates};
};

export function createTemplate(opts) {
	let {template, subTemplates} = createRawTemplate(opts);
	return dom.prepareTemplate(template,
		{stripEmptyText : true, subTemplates});
};

function createRawSectionTemplate({
	title, kinds,
	/* subTemplate: */ buttonGroup})
{
	dbg && assert(buttonGroup instanceof HTMLTemplateElement);

	let templ = dom.cloneTemplate(sectionRawTemplate);
	let refs = dom.collectTemplateRefs(templ);

	if (title !== undefined) {
		dbg && assert.str(title);
		refs.title.textContent = title;
	};

	dbg && common.every(kinds, k => (
		k === tagExpression.wildcardChar || assert(tagExpression.isKind(k))));
	refs.kinds.value = formatSectionKinds(kinds);

	return {
		template : templ,
		stripEmptyText : true,
		subTemplates : {
			...sectionSubTemplates,
			buttonGroup,}};
};

const kSectByKind = Symbol(); /* root[kSectByKind] = Map(kind|'*' → section) */
export function initialise(root) {
	/* note: doesn't intialise button groups */

	let sectByKind = new Map();

	for (let sect of allSections(root)) {
		for (let kind of getSectionKinds(sect)) {
			dbg && (kind === tagExpression.wildcardChar
				|| assert(tagExpression.isKind(kind)));
			if (sectByKind.has(kind)) {
				/* no ambiguity */
				throw new GalkError(
					`multiple sections for kind "${kind}"`);
			};

			sectByKind.set(kind, sect);
		};

		initialiseSection(sect);
	};

	root[kSectByKind] = sectByKind;
};

const kItemSet = Symbol(); /* sect[kItemSet] = SortedSet(item) */
function initialiseSection(sect) {
	let {addPropTextbox, addBtn, propList} = dom.getRefs(sect);
	dbg && assert(propList.firstChild === null);

	sect[kItemSet] = common.createSortedSet();

	/* 'add' button triggers inputPropValue event from the addPropTextbox: */
	prims.initialiseButton(addBtn);
	addBtn.addEventListener(galk.input,
		() => {dispatchAddProp(sect);}, false);

	/* inputPropValue event from the addPropTextbox is triggered by explicit
	user action (i.e. pressing the 'enter' key): */
	prims.initialiseTextbox(addPropTextbox);
	addPropTextbox.addEventListener(galk.commit, ({detail}) => {
		if (detail === `explicit`) {
			dispatchAddProp(sect);};
	}, false);

	updatePropSection(sect);
};

function updatePropSection(sect) {
	// let {} = dom.getRefs(sect);
	// todo:
	// assign section attributes which summarise its contents
};

function dispatchAddProp(sect) {
	/* returns true if event was not cancelled */

	let root = getSectionRoot(sect);
	let {addPropTextbox} = dom.getRefs(sect);
	let {content} = dom.getRefs(addPropTextbox);

	if (!canEdit(root)) {
		return false;};

	if (root.dispatchEvent(
		new CustomEvent(galk.intent.addProp, {
			detail : {
				kinds : [...getSectionKinds(sect)],
				expression : content.textContent,},
			cancelable : true,})))
	{
		/* not cancelled */
		content.textContent = ``;
		return true;
	};
	return false;
};

export function getPropItemSection(item) {
	if (item instanceof HTMLLIElement) {
		let list = item.parentElement;
		if (list instanceof HTMLUListElement) {
			return list.parentElement;};};
	return null;
};

export function getSectionRoot(sect) {
	if (sect instanceof HTMLFieldSetElement) {
		let root = sect.parentElement;
		if (root instanceof HTMLElement
			&& root.classList.contains(galk.propertySheet))
		{
			return root;};};
	return null;
};

export function getPropItemRoot(item) {
	return getSectionRoot(getPropItemSection(item));
};

export function canEdit(root) {
	/* returns: whether ensureEditing(root) would return true */
	dbg && assert(root instanceof HTMLElement);
	let classes = root.classList;
	return !root.classList.contains(galk.readOnly);
};

export function ensureEditing(root) {
	/* returns: whether property sheet is now in editing mode */
	dbg && assert(root instanceof HTMLElement);
	let classes = root.classList;
	if (classes.contains(galk.readOnly)) {
		dbg && assert(!classes.contains(galk.editing));
		return false;
	};
	classes.add(galk.editing);
	return true;
};

export function isEditing(root) {
	dbg && assert(root instanceof HTMLElement);
	return root.classList.contains(galk.editing);
};

export function finishEditing(root, permanent) {
	dbg && assert(root instanceof HTMLElement);
	root.classList.remove(galk.editing);
	if (permanent) {
		root.classList.add(galk.readOnly);};
};

export function isPositiveStatus(s) {
	return s === `` || s === `added`;
};

const getPropsIterProto = {
	next() {
		let {done, value : term} = this.termsIter.next();
		if (done) {
			return {done : true, value : undefined};};
		dbg && tagExpression.assertTerm(term);

		let status;
		let sect = findSectionForKind(this.root[kSectByKind], term.kind);
		if (sect === null) {
			status = `absent`;
		} else {
			let item = undefined;
			common.operateSortedSet(sect[kItemSet], {
				operate : e => (item = e),
				atKey : this.keyFor(term),
				keyFor : e => keyForItem(this.keyFor, e),});
			dbg && (item === undefined || assert(item instanceof HTMLElement));
	
			if (item === undefined) {
				status = `absent`;
			} else {
				let d = item.dataset;
				status = d.status;
				if (status === `edited`) {
					/* status = apparentStatus */
					if (d.origValue === term.value) {
						status = `deleted`;
					} else {
						status = `added`;
					};
				};
			};
		};
		dbg && assert.str(status);

		return {
			done : false,
			value : {
				kind : term.kind,
				value : term.value,
				status}};
	},

	[Symbol]() {return this;},
};

const getPropsResultProto = {
	[Symbol.iterator]() {
		return {
			root : this.root,
			termsIter : this.terms[Symbol.iterator](),
			keyFor : this.keyFor,
			__proto__ : getPropsIterProto,};
	},
};

export function getProps(root, terms, {
	keyFor /* ({kind, value}) => Uint8Array */})
{
	/* yields a sequence of {kind, value, status} */
	dbg && assert(root instanceof HTMLElement);
	dbg && assert.sequ(terms);
	return {root, terms, keyFor, __proto__ : getPropsResultProto};
};

export function allProps(root) {
	/* mutating the propety sheet during iteration is not recommended;
	see comments in `sectionProps` */
	dbg && assert(root instanceof HTMLElement);
	return common.chainFrom(
		Array.from(common.map(
			allSections(root), sectionProps)));
};

const sectionPropsIterProto = {
	next() {
		let {el, prop} = this;
		if (prop !== null) {
			this.prop = null;
			return {done : false, value : prop};
		};

		if (el === null) {
			return {done : true, value : undefined};};

		dbg && assert(el instanceof HTMLElement);

		let {kind, value, valueOrig, status} = el.dataset;
		if (status === `edited`) {
			status = `added`;
			this.prop = {
				kind,
				value : valueOrig,
				status : `deleted`,
				item : el};
		};

		this.el = el.nextElementSibling;

		dbg && assert([``, `added`, `deleted`].includes(status));
		return {done : false, value : {
			kind,
			value,
			status,
			item : el}};
	},
	[Symbol.iterator]() {return this;}
};

const sectionPropsResultProto = {
	[Symbol.iterator]() {
		let {propList} = dom.getRefs(this.section);
		return {
			el : propList.firstElementChild,
			prop : null,
			__proto__ : sectionPropsIterProto,};
	},
};

export function sectionProps(section) {
	/* yields the ordered sequence of apparent properties present in `section`:
		property = {kind, value, status, item}
		status = '' | 'added' | 'deleted'
		item = the associated list element

	items in the 'edited' state will yield two apparent properties:
		{kind, value : <old>, status : 'deleted', item}
		{kind, value : <new>, status : 'added', item}

	warning:
	iteration will end prematurely if the item immediately following the
	current property's item is removed from the list */

	return {section, __proto__ : sectionPropsResultProto};
};

export function operateProps(root, terms, {
	operate, /* ({term, status : string, content : node|null}) =>
		{include : bool, content : node|null} */
	keyFor, /* ({kind, value}) => Uint8Array */})
{
	dbg && assert(root instanceof HTMLElement);
	dbg && assert.fn(operate);

	let affected = new Map(/* kind → value → status */);
	let sectByKind = root[kSectByKind];

	for (let term of terms) {
		dbg && tagExpression.assertTerm(term);

		let sect = findSectionForKind(sectByKind, term.kind);
		if (sect === null) {
			throw new GalkError(`no section for kind "${term.kind}"`);};
		let {propList} = dom.getRefs(sect);

		common.operateSortedSet(sect[kItemSet], {
			atKey : keyFor(term),
			keyFor : item => keyForItem(keyFor, item),
			operate : (item, next) =>
				(item === undefined
					/* insert a new prop item? */
					? operateNewPropItem({
						term, propList, next, operate, affected})
					/* modify an existing prop item? */
					: operateExistingPropItem(item, {
						term, operate, affected})),
		});
	};

	return affected;
};

export function operateAll(root, {
	operate, /* ({term, status : string, content : node|null}) =>
		{include : bool, content : node|null} */
	keyFor, /* ({kind, value}) => Uint8Array */})
{
	let affected = new Map(/* kind → value → status */);

	for (let sect of allSections(root)) {
		let itemSet = sect[kItemSet];
		for (let prop of sectionProps(sect)) {
			common.operateSortedSet(itemSet, {
				atKey : keyFor(prop),
				keyFor : item => keyForItem(keyFor, item),
				operate : (item, _) =>
					operateExistingPropItem(item, {
						term : prop,
						operate,
						affected}),
			});
		};
	};

	return affected;
};

function operateNewPropItem({
	term, /* {kind, value} */
	propList, /* within section */
	next, /* the following item, or null */
	operate, /* ({term, status : string, content : node|null}) =>
		{include : bool, content : node|null} */
	affected /* Map(kind → value → status) */})
{
	dbg && assert.fn(operate);
	dbg && assert(affected instanceof Map);

	let {include, content} = operate({term, status : `absent`, content : null});
	dbg && assert.bool(include);
	if (!include) {
		return undefined; /* don't insert new item */};

	let item = dom.instantiateTemplate(propTemplate).firstChild;
	if (content !== null) {
		dbg && assert(content instanceof Node);
		item.appendChild(content);};

	let {kind, value} = term;
	let d = item.dataset;
	d.value = value;
	d.kind = kind;
	d.status = `added`;

	dbg && assert(propList instanceof HTMLElement);
	dbg && (next === undefined || assert(next instanceof HTMLElement));
	propList.insertBefore(item, next || null);

	ensureSubMap(affected, kind).set(value, `added`);

	item.addEventListener(`focusin`, propItemOnFocusIn, false);
	item.addEventListener(`focusout`, propItemOnFocusOut, false);

	item.dispatchEvent(new CustomEvent(galk.itemCreated,
		{detail : term, bubbles : true}));

	return item;
};

function operateExistingPropItem(item, {
	term,
	operate, /* ({term, status : string, content : node|null}) =>
		{include : bool, content : node|null} */
	affected /* Map(kind → value → status) */})
{
	dbg && assert(item instanceof HTMLElement);
	dbg && assert(item.parentElement instanceof HTMLElement);
	dbg && assert.fn(operate);
	dbg && assert(affected instanceof Map);

	let d = item.dataset;
	let {status} = d;
	let {kind, value} = term;

	let apparentStatus;
	if (status === `edited`) {
		if (value === d.valueOrig) {
			apparentStatus = `deleted`;
		} else {
			apparentStatus = `added`;
		};
	} else {
		apparentStatus = status;
	};

	let content = item.firstChild;
	let {include, content : newContent} =
		operate({term, status : apparentStatus, content});
	dbg && assert.bool(include);

	let alterations = [];

	if (include) {
		alterations = assignPropItem(item, value, d);
	} else if (apparentStatus !== `deleted`) {
		/* delete existing prop: */
		let a = deletePropItem(item, d);
		if (a !== null) {alterations = [a];};
	};

	dbg && assert.arr(alterations);
	let n = alterations.length;
	if (n > 0) {
		let subAff = ensureSubMap(affected, kind);

		for (let i = 0; i < n; ++i) {
			let a = alterations[i];
			subAff.set(a.value, a.status);
		};
	};

	if (item.parentElement !== null) {
		if (newContent !== content) {
			dbg && assert(newContent instanceof Node);
			// item.replaceChildren(newContent); // firefox 78
			item.textContent = ``;
			item.appendChild(newContent);
		};
		return item;
	} else {
		/* item has been removed from the dom: */
		// getItemDisposalInfo(item, kind, value)
		return undefined;
	};
};

export function acceptAll(root, {
	update, /* ({term, status : string, content : node}) => void */
	keyFor, /* ({kind, value}) => Uint8Array */})
{
	let affected = new Map(/* kind → value → status */);

	for (let sect of allSections(root)) {
		let itemSet = sect[kItemSet];
		for (let prop of sectionProps(sect)) {
			let {item, status : apparentStatus} = prop;
			let d = item.dataset;
			let {kind, value, status : itemStatus} = d;
			switch (apparentStatus) {
				case `added` :
					ensureSubMap(affected, kind).set(value, ``);
					d.valueOrig = ``;
					d.status = ``;

					update({term : prop, status : ``,
						content : item.firstChild});

					break;

				case `deleted` :
					ensureSubMap(affected, kind).set(value, `absent`);
					if (itemStatus === `deleted`) {
						/* not in the 'edited' state */

						common.operateSortedSet(itemSet, {
							atKey : keyFor(prop),
							keyFor : item => keyForItem(keyFor, item),
							operate : () => undefined,});

						item.remove();

						// getItemDisposalInfo(item, kind, value)
					};
					break;

				default :
					dbg && assert(apparentStatus === ``);
					/* no change */
					break;
			};
		};
	};

	return affected;
};

export function resetAll(root, {
	update, /* ({term, status : string, content : node}) => void */
	keyFor, /* ({kind, value}) => Uint8Array */})
{
	dbg && assert.fn(update);
	let affected = new Map(/* kind → value → status */);

	for (let sect of allSections(root)) {
		let itemSet = sect[kItemSet];
		for (let prop of sectionProps(sect)) {
			common.operateSortedSet(itemSet, {
				atKey : keyFor(prop),
				keyFor : item => keyForItem(keyFor, item),
				operate : (item, _) => {
					let d = item.dataset;
					let {kind, value, valueOrig, status} = d;

					if (status === ``) {
						return item; /* no change */};

					let subAff = ensureSubMap(affected, kind);

					if (status === `added`) {
						/* dispose added items entirely: */
						// getItemDisposalInfo(item, kind, value)
						item.remove();
						subAff.set(value, `absent`);
						return undefined;
					};

					if (status === `edited`) {
						/* revert edited items: */
						subAff.set(value, `absent`);
						subAff.set(valueOrig, ``);
						value = valueOrig;
						d.value = valueOrig;
						d.valueOrig = ``;
					} else {
						/* set deleted items to untouched: */
						dbg && assert(status === `deleted`);
						subAff.set(value, ``);
					};

					d.status = ``;
					update({term : {kind, value}, status : ``,
						content : item.firstChild});

					return item;
				},
			});
		};
	};

	return affected;
};

function propItemOnFocusIn({
	currentTarget : item,
	target : originalTarget,
	relatedTarget,})
{
	if (!item.contains(relatedTarget)) {
		/* focus changing from outside this item to within it */

		item.dispatchEvent(
			new CustomEvent(
				galk.itemFocusIn,
				{detail : {originalTarget}}));

		/* remove direct focusability, so that shift+tab will
		always move focus to the previous item: */
		item.removeAttribute(`tabindex`);
	};
};

function propItemOnFocusOut({currentTarget : item, relatedTarget}) {
	if (!item.contains(relatedTarget)) {
		/* focus changing from within this item to outside it */

		/* restore direct focusability: */
		item.setAttribute(`tabindex`, `0`);

		item.dispatchEvent(
			new CustomEvent(
				galk.itemFocusOut,
				{detail : {relatedTarget}}));
	};
};

function assignPropItem(item, newValue, d) {
	dbg && assert(item instanceof HTMLElement);
	dbg && assert(d === item.dataset);
	dbg && assert.str(newValue);

	let {value, status} = d;
	switch (status) {
		case `added` :
			dbg && assert(d.valueOrig === ``);
			if (value !== newValue) {
				/* editing a prop which was already added;
				equivalent to delete then add: */
				d.value = newValue;
				return [
					{value, status : `absent`},
					{value : newValue, status : `added`}];
			};
			return []; /* unchanged */
		break;

		case `edited` :
			dbg && assert(d.valueOrig !== value);
			if (value !== newValue) {
				/* editing a prop which was already edited: */
				d.value = newValue;

				if (d.valueOrig === newValue) {
					/* revert edit: */
					d.valueOrig = ``;
					d.status = ``;
					return [
						{value, status : `absent`},
						{value : newValue, status : ``}];
				} else {
					/* still edited; new `value` but same `valueOrig`: */
					return [
						{value, status : `absent`},
						{value : newValue, status : `added`}];
				};
			};
			return []; /* unchanged */
		break;

		case `deleted` :
			dbg && assert(d.valueOrig === ``);
			if (newValue === value) {
				/* un-delete, same value: */
				d.status = ``;
				return [{value, status : ``}];
			} else {
				/* un-delete, new value: */
				d.status = `edited`;
				d.valueOrig = value;
				d.value = newValue;
				return [{value : newValue, status : `added`}];
			};
		break;

		default :
			dbg && assert(d.status === ``);
			dbg && assert(d.valueOrig === ``);
			if (newValue !== value) {
				/* assign new value to existing untouched prop: */
				d.status = `edited`;
				d.valueOrig = value;
				d.value = newValue;
				return [
					{value, status : `deleted`},
					{value : newValue, status : `added`}];
			};
			return []; /* unchanged */
		break;
	};

	dbg && assert(false);
};

function deletePropItem(item, d) {
	dbg && assert(item instanceof HTMLElement);
	dbg && assert(d === item.dataset);

	switch (d.status) {
		case `added` :
			/* revert add: */
			item.remove();
			return {value : d.value, status : `absent`};
		break;

		case `edited` : {
			/* revert edit, then delete: */

			/* apparent props: value 'added', valueOrig 'deleted' */
			let {value, valueOrig} = d;
			d.value = valueOrig;
			d.valueOrig = ``;
			d.status = `deleted`;
			/* apparent props: value 'absent', valueOrig 'deleted' */

			return {value, status : `absent`};
		}; break;

		case `deleted` :
			dbg && assert(d.valueOrig === ``);
			return null; /* no change */
		break;

		default :
			dbg && assert(d.status === ``);
			dbg && assert(d.valueOrig === ``);

			/* delete existing untouched prop: */
			d.status = `deleted`;
			return {value : d.value, status : `deleted`};
		break;
	};

	dbg && assert(false);
};

function findSectionForKind(sectByKind, kind) {
	dbg && assert(tagExpression.isKind(kind));
	dbg && assert(sectByKind instanceof Map);

	let sect = sectByKind.get(kind)
		|| sectByKind.get(tagExpression.wildcardChar);

	dbg && (sect === undefined || assert(sect instanceof HTMLElement));
	return sect || null;
};

const allSectionsIterProto = {
	next() {
		let {value, root} = this;

		if (value === root) {
			value = root.firstElementChild;};

		while (value !== null) {
			value = value.nextElementSibling;
			if (value instanceof HTMLFieldSetElement) {break;};
		};
		this.value = value;

		return {value, done : value === null};
	},

	[Symbol.iterator]() {return this;},
};

const allSectionsResultProto = {
	[Symbol.iterator]() {
		return {
			root : this.root,
			value : this.root,
			__proto__ : allSectionsIterProto,};
	},
};

export function allSections(root) {
	dbg && assert(root instanceof HTMLElement);
	return {root, __proto__ : allSectionsResultProto};
};

function formatSectionKinds(kinds) {
	dbg && assert.sequ(kinds);

	/* kinds are suffixed with ':' to ensure empty ('') can be represented: */
	return common.joinString(
		common.map(kinds, k => k+tagExpression.kindSepChar), ` `);
};

export function getSectionKinds(sect) {
	dbg && assert(sect instanceof HTMLElement);

	let kindsStr = sect.dataset.kinds || ``;
	dbg && assert.str(kindsStr);

	return common.map(
		common.tokeniseString(kindsStr),
		/* strip trailing ':' */
		x => x.slice(-1) === tagExpression.kindSepChar ? x.slice(0, -1) : x);
};

function keyForItem(keyFor, item) {
	dbg && assert(item instanceof HTMLElement);
	let ds = item.dataset;
	dbg && tagExpression.assertTerm(ds);
	return keyFor(ds);
};

//function getItemDisposalInfo(item, kind, value) {
//	let node = item.firstChild;
//	if (node === null) {
//		/* nothing to be disposed */
//		return undefined;};
//
//	return {kind, value, content : node};
//};

/* -------------------------------------------------------------------------- */

/*





















































*/

/* -------------------------------------------------------------------------- */