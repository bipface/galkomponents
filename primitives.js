/* -------------------------------------------------------------------------- */

'use strict';

import * as dom from './dom-templating.js';
import * as common from './common.js';
const {
	dbg,
	assert,
	galk,
	log,} = common;

/* -------------------------------------------------------------------------- */

/* --- textbox --- */

/* galk.input events are triggered by `input` events, after the textbox
flattens its contents.

galk.selectionchange events are triggered after `selectionchange` or `input`
events, but delayed by textboxSelectDelayMs milliseconds and debounced.

note: content.href should be updated on `input` events if necessary,
since shift+enter may cause the href attribute to be removed. */

export const textboxQuery = `.${galk}[role='textbox']`;
export const textboxTemplate = dom.createTemplate(
	`<span role='textbox' class='${galk}'>
		<a @content contenteditable spellcheck='false'></a>
	</span>`,
	{stripEmptyText : true});

export function initialiseTextbox(box, {tabIndex = undefined} = {}) {
	dbg && assert(box instanceof HTMLElement);
	box.addEventListener(`input`, textboxOnInput, false);
	box.addEventListener(`keydown`, textboxOnKeyDown, false);
	box.addEventListener(`focusin`, textboxOnFocusIn, false);

	if (tabIndex !== undefined) {
		dbg && assert.int32(tabIndex);
		dom.getRefs(box).content.tabIndex = tabIndex;
	};

	if (box.contains(box.ownerDocument.activeElement)) {
		textboxOnFocusEntry(box);};
};

export function commitTextbox(box, cause) {
	dbg && assert([`explicit`, `implicit`].includes(cause));
	box.dispatchEvent(
		new CustomEvent(galk.commit, {detail : cause}))
};

export function textboxSuppressNextImplicitCommit(box) {
	/* use if handling explicit commit might cause the textbox to lose focus
	(which would trigger an implicit commit) */
	box.dataset.implicitSuppressed = `true`;
};

function textboxOnKeyDown(ev) {
	let {currentTarget : box, target : content} = ev;

	if (ev.key === `Enter`) {
		if (ev.shiftKey && singleModifierKeyActive(ev)) {
			/* `shift`+`enter` should insert a newline, but the href attribute
			obstructs that behaviour */

			if (dom.getRefs(box).content === content) {
				content.removeAttribute(`href`);};

		} else if (!anyModifierKeyActive(ev)) {
			/* `enter` alone should commit: */
			ev.preventDefault();
			commitTextbox(box, `explicit`);
		};
	};
};

function textboxOnFocusIn({currentTarget : box, relatedTarget}) {
	if (!box.contains(relatedTarget)) {
		/* focus changing from outside this textbox to within it */
		textboxOnFocusEntry(box);
	};
};

function textboxOnFocusEntry(box) {
	delete box.dataset.implicitSuppressed;

	let {onSelectionChange} = attachFocusedHandlers(box);
	onSelectionChange();
};

function attachFocusedHandlers(box) {
	dbg && assert(box.contains(box.ownerDocument.activeElement));

	let onSelectionChange = ensureDebouncedHdlr(box, `selectionchange`,
		afterTextboxSelect.bind(null, box));

	let onFocusOut = function f(ev) {
		return textboxOnFocusOut(f, onSelectionChange, ev);};

	box.addEventListener(`focusout`, onFocusOut, false);
	box.ownerDocument.addEventListener(`selectionchange`,
		onSelectionChange, false);

	return {onSelectionChange, onFocusOut};
};

function textboxOnFocusOut(
	/* bound: */ onFocusOut, onSelectionChange,
	/* event: */ {currentTarget : box, relatedTarget})
{
	if (!(box.contains(relatedTarget))) {
		/* focus changing from within this textbox to outside it */

		box.removeEventListener(
			`focusout`, onFocusOut, false);

		box.ownerDocument.removeEventListener(
			`selectionchange`, onSelectionChange, false);

		if (box.dataset.implicitSuppressed !== `true`) {
			commitTextbox(box, `implicit`);};
	};
};

function afterTextboxSelect(box) {
	box.dispatchEvent(new CustomEvent(galk.selectionchange));
};

function textboxOnInput({currentTarget : box, target : content}) {
	/* some input might not trigger the `selectionchange` event
	(such as pressing the 'delete' key)
	so we trigger it as a matter of course
	since the handler is debounced anyway: */
	let onSelectionChange = ensureDebouncedHdlr(box, `selectionchange`);
	onSelectionChange();

	if (dom.getRefs(box).content === content) {
		/* remove elements, convert <br> to actual linebreaks, normalize: */
		flattenElement(content, el =>
			(el instanceof HTMLBRElement
				? el.ownerDocument.createTextNode(`\n`)
				: null));

		box.dispatchEvent(new CustomEvent(galk.input));
	};
};

/* --- menu --- */

const menuRawTemplate = dom.createRawTemplate(
	`<div @menu class='${galk.menu}' title=''></div>`
	/* title='' overrides the tooltip of its container */);

export const menuTemplate = dom.prepareTemplate(
	dom.cloneTemplate(menuRawTemplate), {stripEmptyText : true});

export function createMenuTemplate({classes = [],}) {
	let templ = dom.cloneTemplate(menuRawTemplate);
	let {menu} = dom.collectTemplateRefs(templ);
	menu.classList.add(...classes);
	return dom.prepareTemplate(templ, {stripEmptyText : true});
};

/* --- list --- */

export function assignList(
	parent,
	values,
	operate /* (node|null, value) => node|null */)
{
	dbg && assert(parent instanceof HTMLElement);
	dbg && assert.sequ(values);
	dbg && assert.fn(operate);

	/* very basic list reconciliation algorithm */

	let i = 0;
	let value;
	let it = values[Symbol.iterator]();
	let node = parent.firstChild;

	for (; !({value} = it.next()).done; ++i) {
		let x = operate(node, value);
		if (x === null) {
			/* don't render this value */
		} else if (x === node) {
			/* existing node updated */
			dbg && assert(node !== null);
			node = node.nextSibling;
		} else {
			/* new node created */
			dbg && assert(x instanceof Node);
			if (node === null) {
				parent.appendChild(x);
			} else {
				node.before(x);};
		};
	};

	if (i === 0) {
		/* delete the whole list: */
		parent.textContent = ``;
	} else {
		/* remove extraneous trailing nodes: */
		while (node !== null) {
			let x = node;
			node = node.nextSibling;
			x.remove();
		};
	};
};

/* --- button --- */

const buttonRawTemplate = dom.createRawTemplate(
	`<a @button role='button' class='${galk} ${galk.btn}' tabindex='-1'>
		<span class='${galk.btnIcon}'></span>
		<span class='${galk.btnLabel}'>@label-text</span>
		@before-end
	</a>`,
	/* use css to hide the icon or label */);

const menuButtonTemplate = dom.prepareTemplate(
	buttonRawTemplate.cloneNode(true),
	{
		stripEmptyText : true,
		subTemplates : {
			beforeEnd : menuTemplate}});
dom.collectTemplateRefs(menuButtonTemplate).button.classList.add(galk.menuBtn);

export const buttonTemplate = dom.prepareTemplate(
	buttonRawTemplate.cloneNode(true),
	{stripEmptyText : true});

export function createButtonTemplate(opts) {
	return createButtonTemplateInternal(buttonTemplate, opts);
};

export function createMenuButtonTemplate(opts) {
	return createButtonTemplateInternal(menuButtonTemplate, opts);
};

export function getMenuButtonRefs(btn) {
	dbg && assert(btn instanceof HTMLElement);
	let btnRefs = dom.getRefs(btn);
	dbg && assert(btnRefs.beforeEnd instanceof HTMLElement);
	let menuRefs = dom.getRefs(btnRefs.beforeEnd);
	return {...btnRefs, ...menuRefs};
};

function createButtonTemplateInternal(baseTempl, opts) {
	let {classes = [], clickMode = `release`} = opts;
	dbg && assert.arr(classes);
	dbg && assert.str(clickMode);

	let templ = dom.cloneTemplate(baseTempl);
	let refs = dom.collectTemplateRefs(templ);

	let {button} = refs;
	button.classList.add(...classes);
	button.dataset.clickMode = clickMode;

	updateButtonInternal(refs.button, refs, opts);

	return templ;
};

export function initialiseButton(btn) {
	/* note: can initialise button elements with different structure than the
	layout in buttonTemplate, and elements which aren't template instances */
	dbg && assert(btn instanceof HTMLElement);

	let {clickMode} = btn.dataset;
	dbg && (clickMode === undefined
		|| assert([`press`, `release`].includes(clickMode)));

	btn.addEventListener(`keydown`, buttonOnInput, false);
	btn.addEventListener(`mousedown`, buttonOnInput, false);
	btn.addEventListener(`click`, buttonOnInput, false);

	if ((dom.getRefs(btn) || {}).labelText !== undefined) {
		btn.addEventListener(`mouseenter`, buttonOnAttention, false);
		btn.addEventListener(`focusin`, buttonOnAttention, false);
	};
};

export function updateButton(btn, opts) {
	return updateButtonInternal(btn, dom.getRefs(btn), opts);
};

function updateButtonInternal(btn, refs,
	{label, description, enabled, toggled, tabIndex,
		suppressDefaultInputEvents,} = {})
{
	dbg && assert(btn instanceof HTMLElement);
	dbg && assert.obj(refs);

	if (label !== undefined) {
		dbg && assert.str(label);
		refs.labelText.data = label;
		btn.setAttribute(`aria-label`, label);
	};

	if (description !== undefined) {
		dbg && assert.str(description);
		btn.dataset.description = description;
	};

	btn.dataset.fullTooltip =
		common.joinString(
			common.filter(
				[refs.labelText.data, btn.dataset.description],
				x => x),
			`\n`);

	if (enabled !== undefined) {
		dbg && assert.bool(enabled);
		if (enabled) {
			btn.removeAttribute(`aria-disabled`);
		} else {
			btn.setAttribute(`aria-disabled`, `true`);};
	};

	if (toggled !== undefined) {
		dbg && assert.bool(toggled);
		if (toggled) {
			btn.setAttribute(`aria-pressed`, `true`);
		} else {
			btn.removeAttribute(`aria-pressed`);};
	};

	if (tabIndex !== undefined) {
		dbg && assert.int32(tabIndex);
		btn.tabIndex = tabIndex;
	};

	if (suppressDefaultInputEvents !== undefined) {
		dbg && assert.bool(suppressDefaultInputEvents);
		btn.dataset.suppressDefaultInputEvents =
			`${suppressDefaultInputEvents}`;
	};
};

function buttonOnInput(ev) {
	dbg && log.debug(`buttonOnInput`);
	/* buttons can be triggered by left-click, spacebar or enter; refer to:
	developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/button_role */

	/* note: can be triggered on button elements with different structure than
	the layout in buttonTemplate, and elements which aren't template
	instances */

	let isMouseEv = (ev instanceof MouseEvent) && ev.button === 0;

	let isKbdEv =
		(ev instanceof KeyboardEvent) && (ev.key === `Enter` || ev.key === ` `);

	if ((!isMouseEv && !isKbdEv) || anyModifierKeyActive(ev)) {return;};

	let btn = ev.currentTarget;

	/* ignore input bubbling up from extra content: */
	let {beforeEnd} = (dom.getRefs(btn) || {});
	if (beforeEnd !== undefined && beforeEnd.contains(ev.target)) {return;};

	let ds = btn.dataset;
	if (ds.suppressDefaultInputEvents === `true`) {
		/* useful if the button has a href which needs
		to behave like a link on rightclick or middleclick */
		dbg && log.debug(`buttonOnInput: preventDefault`);
		ev.preventDefault();
	};

	if (isMouseEv
		&& (ds.clickMode === `press` ? `mousedown` : `click`) !== ev.type)
	{
		return;};

	if (btn.getAttribute(`aria-disabled`) === `true`) {return;};

	if (isKbdEv) {
		/* apply pulse style: */
		let c = btn.classList;
		let x = c.contains(galk.btnPulse0);
		c.toggle(galk.btnPulse0, !x);
		c.toggle(galk.btnPulse1, x);
	};

	/* input source */
	let detail = isMouseEv ? `pointer` : isKbdEv ? `keyboard` : undefined;

	function dispatchInputEv() {
		dbg && log.debug(`buttonOnInput: dispatchInputEv`);
		if (btn.dispatchEvent(
			new CustomEvent(galk.input, {detail, cancelable : true})))
		{
			/* not cancelled */
		};
	};

	if (ev.type === `mousedown`) {
		/* defer input event so the mousedown default handling
		doesn't interfere with our own input handling: */
		dbg && log.debug(`buttonOnInput: queueMicrotask`);
		common.queueMicrotask(dispatchInputEv);
	} else {
		dispatchInputEv();};
};

function buttonOnAttention({currentTarget}) {
	updateButtonTooltip(
		currentTarget,
		dom.getRefs(currentTarget));
	/* tooltip updates incur layout/style recalculation so they should not be
	performed preemptively */
};

function updateButtonTooltip(btn, {labelText}) {
	/* adjust tooltip based on whether the label element is visible */

	dbg && assert(btn instanceof HTMLElement);
	dbg && assert(labelText instanceof Text);
	dbg && assert(labelText.parentNode instanceof HTMLElement);

	let tt =
		btn.offsetParent !== null /* not display:none ? */
		&& labelText.parentNode.offsetParent === null /* has display:none ? */
			? btn.dataset.fullTooltip
			: btn.dataset.description;

	if (tt) {
		btn.title = tt;
	} else {
		btn.removeAttribute(`title`);};
};

/* --- button group --- */

/* an ordered collection of buttons with overflow menu;
note that the set of buttons is fixed at instantiation - they can't be
added/removed dynamically */

export const buttonGroupRawTemplate = dom.createRawTemplate(
	`<fieldset class='${galk} ${galk.btnGroup}'></fieldset>`);

export function createButtonGroupTemplate(opts, btnTemplOpts) {
	let {classes = [], moreTabIndex = undefined, moreLabel = `More…`} = opts;
	dbg && assert.arr(classes);
	dbg && assert.obj(btnTemplOpts);

	let templ = dom.cloneTemplate(buttonGroupRawTemplate);
	let doc = templ.ownerDocument;
	let group = templ.content.firstChild;
	dbg && assert(group instanceof HTMLElement);

	group.classList.add(...classes);

	let subTemplates = {
		more : createMenuButtonTemplate({
			classes : [galk.moreBtn],
			label : moreLabel,
			tabIndex : moreTabIndex,
			clickMode : `press`,})};

	for (let ks = Object.keys(btnTemplOpts), i = 0, n = ks.length; i < n; ++i) {
		let key = ks[i];
		if (key === `more`) {
			throw new GalkError(`invalid key "${key}"`);};

		let opts = btnTemplOpts[key];
		dbg && assert.obj(opts);

		group.appendChild(dom.createRefNode(key));

		subTemplates[key] = createButtonTemplate(opts);
	};

	group.appendChild(dom.createRefNode(`more`));

	return dom.prepareTemplate(templ, {stripEmptyText : true, subTemplates});
};

export function initialiseButtonGroup(group, opts = {}) {
	let refs = dom.getRefs(group);

	for (let b of Object.values(refs)) {
		initialiseButton(b);};

	let {more} = refs;
	more.addEventListener(galk.input, moreButtonOnInput, false);
	more.addEventListener(`focusout`, moreButtonOnFocusOut, false);

	let {menu} = getMenuButtonRefs(refs.more);
	dbg && assert(menu instanceof HTMLElement);
	menu.addEventListener(galk.input, buttonGroupMenuOnInput, true);

	updateButtonGroup(group, opts);
};

export function updateButtonGroup(group, {
	/* list of button keys: */
	order = [],
	/* how many buttons to place at the 'surface' level; remainder will be
	placed in the overflow menu: */
	surfaceCapacity = Infinity,})
{
	dbg && assert(group instanceof HTMLElement);
	dbg && assert.sequ(order);
	dbg && (surfaceCapacity === Infinity || assert.int32(surfaceCapacity))
		&& surfaceCapacity > 0;

	let refs = dom.getRefs(group); /* key → button element */
	let refValues = Object.values(refs);
	dbg && refValues.every(x =>
		(x instanceof HTMLElement && x.parentNode === group));

	let moreBtn = refs.more;
	dbg && assert(moreBtn);

	let {menu} = getMenuButtonRefs(refs.more);
	dbg && assert(menu instanceof HTMLElement);

	let nButtons = refValues.length - 1; /* one is the menu button */
	let nSurface = Math.min(nButtons, surfaceCapacity);
	let nMenu = nButtons - nSurface;
	if (nMenu > 0) {
		/* overflow menu button appears: */
		--nSurface;
		++nMenu;
		moreBtn.hidden = false;
	} else {
		moreBtn.hidden = true;};

	/* ignore nonexistent buttons: */
	let orderIter =
		common.filter(order, k => (k in refs) && k !== `more`)
		[Symbol.iterator]();

	let i = 0;
	let currentBtn = group.firstElementChild;
	for (let value; i < nSurface && !({value} = orderIter.next()).done; ++i) {
		dbg && assert.str(value);
		let btnToInsert = refs[value];
		dbg && assert(btnToInsert);

		if (currentBtn === btnToInsert) {
			/* button already at correct position */
			currentBtn = currentBtn.nextElementSibling;
		} else {
			/* move button to this position: */
			group.insertBefore(btnToInsert, currentBtn);};
	};

	/* if orderIter is exhausted, fill remaining surface space: */
	for (; i < nSurface; ++i, (currentBtn = currentBtn.nextElementSibling)) {
		dbg && assert(currentBtn instanceof HTMLElement);
		if (currentBtn === moreBtn) {
			/* take first button from menu: */
			let btnToInsert = menu.firstElementChild;
			dbg && assert(btnToInsert);
			group.insertBefore(btnToInsert, moreBtn);
		};
	};

	/* move all remaining buttons to overflow menu: */
	for (let lastSurfaceBtn = currentBtn.previousElementSibling;
		(currentBtn = moreBtn.previousElementSibling) !== lastSurfaceBtn;)
	{
		menu.prepend(currentBtn);};

	i = 0;
	currentBtn = menu.firstElementChild;
	for (let value; i < nMenu && !({value} = orderIter.next()).done; ++i) {
		dbg && assert.str(value);
		let btnToInsert = refs[value];
		dbg && assert(btnToInsert);

		if (currentBtn === btnToInsert) {
			/* button already at correct position */
			currentBtn = currentBtn.nextElementSibling;
		} else {
			/* move button to this position: */
			menu.insertBefore(btnToInsert, currentBtn);};
	};
};

function moreButtonOnInput({currentTarget : btn, detail : source, bubbles}) {
	dbg && assert(!bubbles);
	/* invert toggled state: */
	let toggled = btn.getAttribute(`aria-pressed`) !== `true`;
	updateButton(btn, {toggled});

	if (toggled && source !== `pointer`) {
		/* focus first menu item: */
		let {menu} = getMenuButtonRefs(btn);
		dbg && assert(menu instanceof HTMLElement);
		let first = menu.firstElementChild;
		if (first !== null) {
			first.focus();};
	};
};

function moreButtonOnFocusOut({currentTarget : btn, relatedTarget}) {
	if (!btn.contains(relatedTarget)) {
		/* focus changing from within this menu to outside it */
		updateButton(btn, {toggled : false});
	};
};

function buttonGroupMenuOnInput(ev) {
	let {currentTarget : menu, target : btn} = ev;
	common.queueMicrotask(() => {
		if (ev.defaultPrevented) {return;};

		if (btn.contains(menu.ownerDocument.activeElement)) {
			/* a button inside the menu has been activated and the event
			was not cancelled, but the button is still focused;
			handle this situation by collapsing the menu: */
			let more = menu.parentElement;
			if (more === null) {return;};
			updateButton(more, {toggled : false});
			more.focus();
		};
	});
};

/* --- utilities --- */

export function modifierKeyBits(ev) {
	dbg && assert(ev instanceof UIEvent);
	return ((ev.altKey << 0)
		| (ev.ctrlKey << 1)
		| (ev.metaKey << 2)
		| (ev.shiftKey << 3));
};

export function anyModifierKeyActive(ev) {
	return (ev instanceof UIEvent)
		&& modifierKeyBits(ev) !== 0;
};

export function singleModifierKeyActive(ev) {
	if (!(ev instanceof UIEvent)) {
		return false;};

	let bits = modifierKeyBits(ev);
	return (bits & (bits - 1)) === 0;
};

export function assignSelectionNodesContents(doc, nodes) {
	dbg && assert(doc instanceof HTMLDocument);
	dbg && assert.sequ(nodes);

	let s = getSelection(doc);
	s.removeAllRanges();

	for (let node of nodes) {
		dbg && assert(node instanceof Node);
		let r = doc.createRange();
		r.selectNodeContents(node);
		s.addRange(r);
	};
};

export function getSelection(doc) {
	dbg && assert(doc instanceof HTMLDocument);
	let wnd = doc.defaultView;
	if (wnd !== null) {
		dbg && assert(wnd instanceof Window);
		return wnd.getSelection();
	};
	return null;
};

export function flattenElement(el, replacer = () => null) {
	dbg && assert(el instanceof HTMLElement);
	dbg && assert.fn(replacer);

	/* remove all element descendants of `el`,
	leaving behind any text nodes within: */
	for (let subEl; (subEl = el.firstElementChild) !== null;) {
		let c = subEl.firstChild;
		if (c !== null) {
			el.insertBefore(c, subEl);
		} else {
			let newNode = replacer(subEl);
			if (newNode !== null) {
				dbg && assert(newNode instanceof Node);
				dbg && assert(!(newNode instanceof Element));
				el.insertBefore(newNode, subEl);
			};
			el.removeChild(subEl);};
	};

	dbg && assert(el.firstElementChild === null);

	el.normalize();
};

export function tryCopySelectionToClipboard(doc) {
	dbg && assert(doc instanceof HTMLDocument);
	try {return doc.execCommand(`copy`);} catch (_) {return false;};
	// todo: support navigator.clipboard
};

export function randomHexString() {
	return ((Math.random() * 0x7fffffff)|0).toString(16).padStart(8, `0`);
};

const debounceDelayMs = 50; // todo: config?
const kDebounceState = Symbol();
/* element[kDebounceState] = {key : {f, d, t}} */

export function ensureDebouncedHdlr(el, key, f = null) {
	dbg && (f === null || assert.fn(f));

	let s = getDebounceState(el, key);
	if (s === null) {
		if (f === null) {
			f = () => {};};

		s = {f, d : null, t : -1};
		s.d = debounce.bind(null, s);

		assignDebounceState(el, key, s);

	} else if (f !== null) {
		s.f = f;
	};

	return s.d;
};

function debounce(/* bound: */ s) {
	dbg && assert.num(s.t);
	if (s.t >= 0) {
		clearTimeout(s.t);};

	dbg && assert.fn(s.f);
	s.t = setTimeout(s.f, debounceDelayMs);
};

function getDebounceState(el, key) {
	dbg && assert(el instanceof HTMLElement);
	dbg && assert.str(key);

	let byKey = el[kDebounceState];
	if (byKey !== undefined) {
		dbg && assert.obj(byKey);

		let s = byKey[key];
		if (s !== undefined) {
			dbg && assert.obj(s);
			dbg && assert.fn(s.d);
			dbg && assert.fn(s.f);
			dbg && assert.num(s.t);

			return s;
		};
	};

	return null;
};

function assignDebounceState(el, key, s) {
	dbg && assert(el instanceof HTMLElement);
	dbg && assert.str(key);
	dbg && assert.obj(s);

	let byKey = el[kDebounceState];
	if (byKey === undefined) {
		el[kDebounceState] = {[key] : s};
	} else {
		dbg && assert.obj(byKey);
		byKey[key] = s;
	};
};

/* -------------------------------------------------------------------------- */

/*





















































*/

/* -------------------------------------------------------------------------- */