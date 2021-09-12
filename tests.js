/* -------------------------------------------------------------------------- */

'use strict';

import * as tagExpression from './tag-expression.js';
import * as formAdapter from './property-sheet-form-adapter.js';
import * as propInfoSvc from './property-information-service-danbooru.js';
import * as common from './common.js';
const {
	assert,
	log,
	compareArrays,} = common;

/* -------------------------------------------------------------------------- */

export function runAll() {
	let nTotal = 0;
	let nFailed = 0;

	for (let ks = Object.keys(this), i = 0, n = ks.length; i < n; ++i) {
		let f = this[ks[i]];
		if (f === runAll) {continue;};

		++nTotal;
		++nFailed;
		try {
			f();
			--nFailed;
		} catch (err) {
			log.error(`test failed "${ks[i]}"`, err);};
	};

	log(`${nTotal - nFailed}/${nTotal} tests succeeded`);

	return nFailed === 0;
};

/* -------------------------------------------------------------------------- */

/* --- sorted set --- */

export function createSortedSet() {
	let m = common.createSortedSet();
	assert.obj(m);
};

export function operateSortedSetRandom() {
	let seed = 1770278786;
	function rndByte() {
		return (seed = int32Hash(seed, 0)) & 0xff;
	};
	function rndKey() {
		let n = rndByte() & 0xf;
		let k = new Uint8Array(n);
		for (let i = 0; i < n; ++i) {k[n] = rndByte();};
		return k;
	};

	/* 100 keys; 1000 operations: 75% insertions, 25% deletions */

	let keys = [...common.map(common.iota(100), rndKey)];
	let m = common.createSortedSet();
	let arr = []; /* reference array */

	for (let i = 0; i < 1000; ++i) {
		let k = keys[i % 100];
		if ((rndByte() & 0b11) === 0) {
			testSortedSetDeleteKeys(m, arr, [k]);
		} else {
			testSortedSetInsertKeys(m, arr, [k]);
		};
	};
};

export function operateSortedSetOperateKeysWithCommonPrefix() {
	let m = common.createSortedSet();
	let arr = []; /* reference array */

	let seed = 1770278786;
	function rndByte() {
		return (seed = int32Hash(seed, 0)) & 0xff;
	};

	/* insert: */
	for (let i = 0; i < 3; ++i) {
		let ks1 = common.map(common.iota(3), j => (new Uint8Array(j)).fill(i));
		testSortedSetInsertKeys(m, arr, ks1);

		let ks2 = [...common.map(common.iota(3), j => {
			let ks = new Uint8Array(j + 1);
			ks.fill(i);
			ks[j] = rndByte();
			return ks;
		})];
		testSortedSetInsertKeys(m, arr, ks2);
	};

	/* delete: */
	let allKeys = arr.slice();
	testSortedSetDeleteKeys(m, arr, allKeys);
};

export function operateSortedSetDeleteFromRoot() {
	let m = common.createSortedSet();
	let arr = []; /* reference array */
	testSortedSetInsertKeys(m, arr, [
		Uint8Array.of(112, 111, 111, 108, 58, 49, 49),
		Uint8Array.of(116, 121, 112, 101, 58, 95, 110, 117, 117, 108, 108)]);
	testSortedSetDeleteKeys(m, arr, [
		Uint8Array.of(112, 111, 111, 108, 58, 49, 49)]);
};

export function operateSortedSetSomething() {
	// todo: remember which code-path this tests
	let utf8Enc = new TextEncoder();
	let keyFor = (s) => utf8Enc.encode(s);
	let m = common.createSortedSet();
	let arr = []; /* reference array */

	testSortedSetInsertKeys(m, arr, [
		`navel`,
		`original`,
		`shiny`,
		`shiny_hair`,
		`succubus`,
		`swimsuit`,
		`white_background`,].map(keyFor));
	testSortedSetInsertKeys(m, arr, [
		`shigekikkusu`,
		`shigekikkusa`,
		`shigekikusa`,].map(keyFor));
	testSortedSetDeleteKeys(m, arr, [
		`shigekikkusu`,
		`shigekikkusa`,
		`shigekikusa`,].map(keyFor));
	testSortedSetInsertKeys(m, arr, [
		`shigekikusa`,].map(keyFor));
};

export function bitTrieElevateBranchInto() {
	let branch = {
		branchBmp : ~0b1000000000000000000,
		leafBmp : ~0b1000000000000000000,
		subs : [
			`shigekikkusu`,
			{
				branchBmp : 0b1000000000000000000000000000,
				leafBmp : 0b10000000000000000000000000,
				subs : [
					`shigekikusa`,
					{
						branchBmp : ~0,
						leafBmp : ~0b10000000000000000000,
						subs : [`shiny`, `shiny_hair`]
					}
				]
			}
		]
	};

	/* delete 'shigekikkusu' by elevating the sub-branch into branch: */
	common._bitTrieElevateBranchInto(
		branch.subs[1], branch, 0b1000000000000000000);

	assert(branch.leafBmp === ~0b1000000000000000000);
	assert(branch.branchBmp === ~0b1000000000000000000);
	assert(branch.subs[0] === `shigekikusa`);
	assert(branch.subs[1].leafBmp === ~0b1000000000000000000000000000);
	assert(branch.subs[1].branchBmp === ~0);
	assert(branch.subs[1].subs[0] === `shiny`);
	assert(branch.subs[1].subs[1] === `shiny_hair`);
};

export function operateSortedSetElevateBranchWithoutCollapsing() {
	/* test the code path where deleting a key leads to elevating
	a branch which itself contains three or more keys in its sub-tree */

	let utf8Enc = new TextEncoder();
	let keyFor = (s) => utf8Enc.encode(s);

	let m = common.createSortedSet();
	let arr = []; /* reference array */

	testSortedSetInsertKeys(m, arr, [
		`horoyuki_(gumizoku)`,
		`azur_lane`,
		`aylwin_(azur_lane)`,
		`ribbed_sweater`,
		`sweater`,
		`tsurime`,
		`turtleneck_leotard`,
		`highres`,
		`1girl`,
		`bangs`,
		`blush`,
		`breasts`,
		`covered_navel`,
		`eyebrows_visible_through_hair`,
		`hair_between_eyes`,
		`hat`,
		`headband`,
		`plump`,
		`red_eyes`,
		`medium_hair`,].map(keyFor));

	/* delete 'medium_hair'; this will invoke `bitTrieElevateBranchInto`,
	but `dest.subs[1]` will remain as `branch`,
	leaving `dest` with subs `[leaf, branch]`: */
	common.operateSortedSet(m, {
		operate : () => undefined,
		atKey : keyFor(`medium_hair`),
		keyFor : x => x,});

	arrayDeleteKey(arr, keyFor(`medium_hair`));

	assertSortedSetEquivArray(m, arr);

	/* insert 'medium_hair' */
	common.operateSortedSet(m, {
		operate : () => keyFor(`medium_hair`),
		atKey : keyFor(`medium_hair`),
		keyFor : x => x,});

	arrayUpsertKey(arr, keyFor(`medium_hair`));
	arr.sort(compareArrays);

	assertSortedSetEquivArray(m, arr);
};

function testSortedSetInsertKeys(m, arr /* reference array */, keys) {
	let keyFor = x => {
		assert(x instanceof Uint8Array);
		return x;
	};

	for (let k of keys) {
		let expectNext = arrayFindNext(arr, k);
		arrayUpsertKey(arr, k);

		common.operateSortedSet(m, {
			operate : (_, next) => {
				assert(equivKeysOrUndef(next, expectNext));
				return k;
			},
			atKey : k,
			keyFor,});
	};

	arr.sort(compareArrays);
	assertSortedSetEquivArray(m, arr);
};

function testSortedSetDeleteKeys(m, arr /* reference array */, keys) {
	let keyFor = x => {
		assert(x instanceof Uint8Array);
		return x;
	};

	for (let k of keys) {
		let expectNext = arrayFindNext(arr, k);
		arrayDeleteKey(arr, k);
		common.operateSortedSet(m, {
			operate : (_, next) => {
				assert(equivKeysOrUndef(next, expectNext));
				return undefined;
			},
			atKey : k,
			keyFor,});
	};

	arr.sort(compareArrays);
	assertSortedSetEquivArray(m, arr);
};

function assertSortedSetEquivArray(m, arr) {
	/* assumes `arr` is sorted and has no duplicates */
	let i = 0;
	for (let x of common.iterateSortedSet(m)) {
		assert(compareArrays(x, arr[i]) === 0);
		++i;
	};
};

function arrayUpsertKey(a, k) {
	if (!a.some(x => compareArrays(x, k) === 0)) {
		a.push(k);};
};

function arrayDeleteKey(a, k) {
	for (let i;
		(i = a.findIndex(x => compareArrays(x, k) === 0)) >= 0;)
	{
		a.splice(i, 1);
	};
};

function arrayFindNext(a, k) {
	let next = undefined;
	for (let i = 0, n = a.length; i < n; ++i) {
		let x = a[i];
		if (compareArrays(k, x) < 0
			&& (!next || compareArrays(x, next) < 0))
		{
			next = x;
		};
	};
	return next;
};

function int32Hash(val, seed) {
	/* MurmurHash3 32-bit single round */
	let h = Math.imul(val, 0xcc9e2d51);
	h = (h << 15) | (h >>> 17);
	h = Math.imul(h, 0x1b873593) ^ seed;
	h = (h << 13) | (h >>> 19);
	return (h * 5 + 0xe6546b64)|0;
};

function equivKeysOrUndef(k0, k1) {
	if (k0 === k1) {return true;};
	if (!k0 || !k1) {return false;};
	return compareArrays(k0, k1) === 0;
};

/* --- tag expressions --- */

export function normaliseTerm() {
	let f = tagExpression.normaliseTerm;
	assert(f({value : `Axe`, kind : ``}).value === `axe`);
	// todo
};

export function tryFormatTermWithEmptyUnqual() {
	let f = tagExpression.tryFormatTerm;
	assert.undef(f({op : ``, kind : ``, value : ``}));
	assert.undef(f({op : `-`, kind : ``, value : ``}));
	assert.undef(f({op : `~`, kind : ``, value : ``}));
};

export function tryFormatTermWithKindInValue() {
	let f = tagExpression.tryFormatTerm;
	/* invalid tags: */
	assert.undef(f({op : ``, kind : ``, value : `status:active`}));
	assert.undef(f({op : ``, kind : ``, value : `md5:ff`}));
};

export function tryFormatTermWithQuotes() {
	let f = tagExpression.tryFormatTerm;

	assert(f({op : ``, kind : `a`, value : ` `}) === `a:' '`);
	assert(f({op : ``, kind : `a`, value : `"`}) === `a:'"'`);
	assert(f({op : ``, kind : `a`, value : `'" `}) === `a:'\\'" '`);

	assert(f({op : ``, kind : ``, value : `'"`}) === `'"`);
};

export function tryFormatTermMeta() {
	let f = tagExpression.tryFormatTerm;
	assert(f({op : ``, kind : `parent`, value : `111`}) === `parent:111`);
};

export function isValidTagWithKindInValue() {
	let f = tagExpression.isValidTag;
	assert(!f(`status:active`));
	assert(!f(`md5:ff`));
	assert(!f(`pixiv_id:1`));
	assert(f(`:x`));
};

export function parseTagXprEmpty() {
	let a = assertTagXprTerms;
	a(``);
	a(` `);
	a(String.fromCodePoint(...common.whitespaceCodePoints));
};

export function parseTagXprSimple() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	a(`a`, t(`a`, 0, 1));
	a(`aa`, t(`aa`, 0, 2));
	a(`a b`, t(`a`, 0, 1), t(`b`, 2, 3));
	a(`aa bb`, t(`aa`, 0, 2), t(`bb`, 3, 5));
	a(`  a  b  `, t(`a`, 2, 3), t(`b`, 5, 6));
	a(`  aa  bbb  `, t(`aa`, 2, 4), t(`bbb`, 6, 9));
};

export function parseTagXprWithOperator() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let {union, exclude} = tagExpression.termOps;
	a(`-`, t(`-`, 0, 1));
	a(`~`, t(`~`, 0, 1));
	a(`~-`, t(`-`, 0, 2, {op : union}));
	a(`-~`, t(`~`, 0, 2, {op : exclude}));
	a(` ~ - `, t(`~`, 1, 2), t(`-`, 3, 4));
	a(` - ~ `, t(`-`, 1, 2), t(`~`, 3, 4));
	a(`-aaa`, t(`aaa`, 0, 4, {op : exclude}));
	a(`-a-a`, t(`a-a`, 0, 4, {op : exclude}));
	a(`~aaa`, t(`aaa`, 0, 4, {op : union}));
	a(`~a~a`, t(`a~a`, 0, 4, {op : union}));
	a(`~aaa ~bbb`,
		t(`aaa`, 0, 4, {op : union}),
		t(`bbb`, 5, 9, {op : union}));
};

export function parseTagXprWithAlmostMeta() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let {union, exclude} = tagExpression.termOps;
	a(`:`, t(`:`, 0, 1));
	a(`::`, t(`::`, 0, 2));
	a(`-:`, t(`:`, 0, 2, {op : exclude}));
	a(`~:`, t(`:`, 0, 2, {op : union}));
	a(`>:`, t(`>:`, 0, 2));
	a(`":`, t(`":`, 0, 2));
	a(`:3`, t(`:3`, 0, 2));
};

export function parseTagXprWithMeta() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let m = metatagXprTerm;
	a(`age:<1hour`, m(`age`, `<1hour`, 0, 10));
	a(` age:<1hour `, m(`age`, `<1hour`, 1, 11));
	a(`age: <1hour`, m(`age`, ``, 0, 4), t(`<1hour`, 5, 11));
	a(`md5:0abc`, m(`md5`, `0abc`, 0, 8));
	a(`MD5:0ABC`, m(`md5`, `0ABC`, 0, 8));
	a(`pixiv_id:99`, m(`pixiv_id`, `99`, 0, 11));
	a(`3:`, m(`3`, ``, 0, 2));
	a(`_:`, m(`_`, ``, 0, 2));
	a(`_:x`, m(`_`, `x`, 0, 3));
	a(`a::`, m(`a`, `:`, 0, 3));
	a(`a: b:`, m(`a`, ``, 0, 2), m(`b`, ``, 3, 5));
};

export function parseTagXprWithOperatorAndMeta() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let m = metatagXprTerm;
	let {union, exclude} = tagExpression.termOps;
	a(`-a:b`, m(`a`, `b`, 0, 4, {op : exclude}));
	a(`-a:`, m(`a`, ``, 0, 3, {op : exclude}));
	a(`~a:b`, t(`a:b`, 0, 4, {op : union}));
	a(`~a:`, t(`a:`, 0, 3, {op : union}));
	a(`a:b-c`, m(`a`, `b-c`, 0, 5));
	a(`-a:b-c`, m(`a`, `b-c`, 0, 6, {op : exclude}));
	a(`a:-`, m(`a`, `-`, 0, 3));
	a(`-a:-`, m(`a`, `-`, 0, 4, {op : exclude}));
	a(`a:~`, m(`a`, `~`, 0, 3));
	a(`-a:~`, m(`a`, `~`, 0, 4, {op : exclude}));
	a(`a-:-`, t(`a-:-`, 0, 4));
	a(`a~:~`, t(`a~:~`, 0, 4));
	a(`-a-:`, t(`a-:`, 0, 4, {op : exclude}));
};

export function parseTagXprWithWildcard() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let m = metatagXprTerm;
	a(`a`, t(`a`, 0, 1, {hasWildcard : false}));
	a(`a*`, t(`a*`, 0, 2, {hasWildcard : true}));
	a(`*a`, t(`*a`, 0, 2, {hasWildcard : true}));
	a(`a*a`, t(`a*a`, 0, 3, {hasWildcard : true}));
	a(`a:*a`, m(`a`, `*a`, 0, 4, {hasWildcard : true}));
	a(`a*:a`, t(`a*:a`, 0, 4, {hasWildcard : true}));
	a(`*a:a`, t(`*a:a`, 0, 4, {hasWildcard : true}));
	a(`*:a`, t(`*:a`, 0, 3, {hasWildcard : true}));
	a(`a:*`, m(`a`, `*`, 0, 3, {hasWildcard : true}));
	a(`a:'*'`, m(`a`, `*`, 0, 5, {hasWildcard : true}));
	a(`a:'*a'`, m(`a`, `*a`, 0, 6, {hasWildcard : true}));
	a(`a:"*a"`, m(`a`, `*a`, 0, 6, {hasWildcard : true}));
};

export function parseTagXprWithQuotesEmpty() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let m = metatagXprTerm;
	a(`a:'`, m(`a`, `'`, 0, 3));
	a(`a:"`, m(`a`, `"`, 0, 3));
	a(`a:''`, m(`a`, ``, 0, 4));
	a(`a:""`, m(`a`, ``, 0, 4));
	a(`a:' '`, m(`a`, ` `, 0, 5));
	a(`a:" "`, m(`a`, ` `, 0, 5));
	a(`a:'"`, m(`a`, `'"`, 0, 4));
	a(`a:'"`, m(`a`, `'"`, 0, 4));
	a(`'`, t(`'`, 0, 1));
	a(`"`, t(`"`, 0, 1));
	a(`''`, t(`''`, 0, 2));
	a(`""`, t(`""`, 0, 2));
};

export function parseTagXprWithQuotes() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let m = metatagXprTerm;

	a(`a:'b'`, m(`a`, `b`, 0, 5));
	a(`a:'b' `, m(`a`, `b`, 0, 5));
	a(`a:"b"`, m(`a`, `b`, 0, 5));
	a(`a:'b`, m(`a`, `'b`, 0, 4));
	a(`a:"b`, m(`a`, `"b`, 0, 4));
	a(`a:'b `, m(`a`, `'b`, 0, 4));
	a(`a:"b `, m(`a`, `"b`, 0, 4));
	a(`a:b'c`, m(`a`, `b'c`, 0, 5));
	a(`a:b"c`, m(`a`, `b"c`, 0, 5));
	a(`a:b'c'd `, m(`a`, `b'c'd`, 0, 7));
	a(`a:b"c"d `, m(`a`, `b"c"d`, 0, 7));
	a(`a:'b c'`, m(`a`, `b c`, 0, 7));
	a(`a:'b c`, m(`a`, `'b`, 0, 4), t(`c`, 5, 6));

	/* quotes can delimit tokens without spaces between: */
	a(`a:'b'c`, m(`a`, `b`, 0, 5), t(`c`, 5, 6));
	a(`a:'b"c`, m(`a`, `'b"c`, 0, 6));
	a(`a:"b"c`, m(`a`, `b`, 0, 5), t(`c`, 5, 6));
	a(`a:'b''c'`, m(`a`, `b`, 0, 5), t(`'c'`, 5, 8));
	a(`a:"b""c"`, m(`a`, `b`, 0, 5), t(`"c"`, 5, 8));
	a(`a:'b'c:'d'`, m(`a`, `b`, 0, 5), m(`c`, `d`, 5, 10));
	a(`a:'b'c:"d"`, m(`a`, `b`, 0, 5), m(`c`, `d`, 5, 10));
	a(`a:'b' c:'d'`, m(`a`, `b`, 0, 5), m(`c`, `d`, 6, 11));
};

/*export function parseTagXprWithEmptyPlaceholder() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let m = metatagXprTerm;
	a(`none`, t(`none`, 0, 4));
	a(`:none`, t(`:none`, 0, 5));
	a(`parent:none`, m(`parent`, ``, 0, 11));
};*/

export function parseTagXprWithEscape() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let m = metatagXprTerm;

	a(`a:s\\ df`, m(`a`, `s df`, 0, 7));
	a(`a:\\ `, m(`a`, ` `, 0, 4));
	a(`a:'s\\ df\\\\`, m(`a`, `'s df\\\\`, 0, 10));

	a(`a:'s\\ df'`, m(`a`, `s df`, 0, 9));
	a(`a:"s\\ df"`, m(`a`, `s df`, 0, 9));

	a(`a:'\\'sq\\' "dq"'`, m(`a`, `'sq' "dq"`, 0, 15));
	a(`a:'\\'sq\\' \\"dq\\"'`, m(`a`, `'sq' "dq"`, 0, 17));
	a(`a:"'sq' \\"dq\\""`, m(`a`, `'sq' "dq"`, 0, 15));

	/* within quotes, escapes are recognised before any character: */
	a(`a:"\\s\\d\\f"`, m(`a`, `sdf`, 0, 10));
	a(`a:'\\s\\d\\f'`, m(`a`, `sdf`, 0, 10));

	/* outside quotes, escapes are only recognised before whitespace: */
	a(`a:\\s\\d\\f`, m(`a`, `\\s\\d\\f`, 0, 8));

	/* escapes are only recognised in metatags: */
	a(`a\\ b`, t(`a\\`, 0, 2), t(`b`, 3, 4));
	a(`\\`, t(`\\`, 0, 1));
	a(`\\  `, t(`\\`, 0, 1));

	a(`a:s\\\tdf`, m(`a`, `s\tdf`, 0, 7));
	a(`a:s\\\r\\\ndf`, m(`a`, `s\r\ndf`, 0, 9));

	a(`a\\:sdf`, t(`a\\:sdf`, 0, 6));
	a(`\\-sdf`, t(`\\-sdf`, 0, 5));
};

export function parseTagXprWithSurrogatePairs() {
	let a = assertTagXprTerms;
	let t = tagXprTerm;
	let m = metatagXprTerm;

	// todo
};

function tagXprTerm(value, beginIndex, endIndex, rest = {}) {
	return {value, beginIndex, endIndex, ...rest};
};

function metatagXprTerm(kind, value, beginIndex, endIndex, rest = {}) {
	return {kind, value, beginIndex, endIndex, ...rest};
};

function assertTagXprTerms(s, ...xs) {
	assert.arr(xs);

	let i = 0;
	for (let value, iter = tagExpression.parseTerms(s)[Symbol.iterator]();
		!({value} = iter.next()).done;
		++i)
	{
		let expect = xs[i];
		assert.obj(expect);
		assert.obj(value);

		assert.str(value.op);
		assert(value.op === (expect.op || ``));
		assert.str(value.kind);
		assert(value.kind === (expect.kind || ``));
		assert.str(value.value);
		assert(value.value === (expect.value || ``));
		assert.bool(value.hasWildcard);
		assert(value.hasWildcard === !!(expect.hasWildcard));
		assert.uint31(value.beginIndex);
		assert(value.beginIndex === expect.beginIndex);
		assert.uint31(value.endIndex);
		assert(value.endIndex === expect.endIndex);
	};

	assert(i === xs.length);
};

/* --- prop info svc --- */

export function getPropWikiPageHrefForSource() {
	assert(propInfoSvc.getPropWikiPageHref({kind : `source`, value : `asdf`})
		=== `/wiki_pages/help:image_source`);
};

export function getPropWikiPageHrefForParent() {
	assert(propInfoSvc.getPropWikiPageHref({kind : `parent`, value : `111`})
		=== `/wiki_pages/help:post_relationships`);
};

export function getPropWikiPageHrefForRating() {
	assert(propInfoSvc.getPropWikiPageHref({kind : `rating`, value : `q`})
		=== `/wiki_pages/howto:rate`);
};

export function getPropWikiPageHrefForTag() {
	assert(propInfoSvc.getPropWikiPageHref({kind : ``, value : `blush`})
		=== `/wiki_pages/blush`);
};

export function getPropWikiPageHrefForTagWithOp() {
	assert(propInfoSvc.getPropWikiPageHref({kind : ``, value : `pig`, op : `-`})
		=== `/wiki_pages/pig`);
};

export function getPropWikiPageHrefForTagWithMixedCase() {
	assert(propInfoSvc.getPropWikiPageHref({kind : ``, value : `BlUsH`})
		=== `/wiki_pages/blush`);
};

export function getPropWikiPageHrefForTagWithSymbols() {
	assert(propInfoSvc.getPropWikiPageHref({kind : ``, value : `blu/sh`})
		=== `/wiki_pages/blu%2Fsh`);
};

export function getPropWikiPageHrefForTagWithInvalidChars() {
	assert(propInfoSvc.getPropWikiPageHref({kind : ``, value : `blu\nsh`})
		=== undefined);
};

export function getPropWikiPageHrefForUnrecognised() {
	assert(propInfoSvc.getPropWikiPageHref({kind : `asdf`, value : `asdf`})
		=== undefined);
};

export function getPropGotoHrefForParent() {
	assert(propInfoSvc.getPropGotoHref({kind : `parent`, value : `111`})
		=== `/posts?tags=parent%3A111`);
};

export function getPropGotoHrefForParentWithInvalidDigits() {
	assert(propInfoSvc.getPropGotoHref({kind : `parent`, value : `1a11`})
		=== undefined);
};

export function getPropGotoHrefForSourceWithInvalidHref() {
	assert(propInfoSvc.getPropGotoHref({kind : `source`, value : `!@#$%^&*`})
		=== undefined);
};

export function getPropGotoHrefForSourceWithUnsafeHref() {
	assert(propInfoSvc.getPropGotoHref(
		{kind : `source`, value : `somescheme://u:p@hostname/`})
		=== undefined);
};

export function getPropGotoHrefForTag() {
	assert(propInfoSvc.getPropGotoHref({kind : ``, value : `blush`})
		=== `/posts?tags=blush`);
};

export function getPropGotoHrefForUnrecognised() {
	assert(propInfoSvc.getPropGotoHref({kind : `asdf`, value : `asdf`})
		=== undefined);
};

/* --- form adapter --- */

export function assignTermsToTextRange() {
	let initialText = ``
	let terms = [
		{kind : ``, value : `a`, op : `-`},];
	formAdapter.assignTermsToTextRange(terms, initialText, () => assert(false));
};

/* -------------------------------------------------------------------------- */

/*




























































*/

/* -------------------------------------------------------------------------- */