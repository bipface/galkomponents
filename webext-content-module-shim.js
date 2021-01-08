/* -------------------------------------------------------------------------- */

'use strict';

const doc = document;

/* -------------------------------------------------------------------------- */

let rt = (typeof browser !== `undefined` ? browser :
	typeof chrome !== `undefined` ? chrome : {}).runtime;
if (rt === undefined) {
	throw new Error(`can't find browser.runtime api`);};

if (!(doc instanceof HTMLDocument)) {
	throw new Error(`can't find "document" object`);};
if (!(doc.head instanceof HTMLHeadElement)) {
	throw new Error(`can't find <head> element`);};

/* 2019-12-30: firefox currently cannot load javascript modules as content
scripts, so inject our code for loading as an ordinary <script> element.
note that the "web_accessible_resources" section of the manifest must be
configured to allow access to our internal resources. */

let scriptHref = rt.getURL(`./webext-content.js`);
if (doc.querySelector(`script[src='${scriptHref}']`) !== null) {
	console.log(`[galk] content module is already loaded ("${scriptHref}")`);
} else {
	console.log(
		`[galk] attempting to load content module via <script> injection ...`);
	
	let s = doc.createElement('script');
	s.type = `module`;
	s.src = scriptHref;
	doc.head.appendChild(s);
};

/* -------------------------------------------------------------------------- */

/*








































*/

/* -------------------------------------------------------------------------- */