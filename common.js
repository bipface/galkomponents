/* -------------------------------------------------------------------------- */

'use strict';

/* -------------------------------------------------------------------------- */

export const dbg = true;

const qualifierOp = {get : (t, name) => (
	typeof name === `string`
		? qualifier(`${t.ns}-${name}`)
		: (_ => `${t.ns}`))};
function qualifier(ns) {
	return new Proxy({ns}, qualifierOp);};

export const namespace = `galk`;
export const galk = qualifier(namespace);

export function isIterable(xs) {
	return xs != null && typeof xs[Symbol.iterator] === `function`;
};

export function isAsyncIterable(xs) {
	return xs != null && typeof xs[Symbol.asyncIterator] === `function`;
};

function isValidLength(len) {
	return Number.isSafeInteger(len) && len >= 0;
};

function lengthOf(xs) {
	let len = Object(xs).length;
	return isValidLength(len) ? len : -1;
};

function hasLength(xs) {
	return lengthOf(xs) >= 0;
};

export function isInt32(x) {
	return typeof x === `number` && (x|0) === x;
};

export function int32Popcnt(i) {
	i = i - ((i >>> 1) & 0x55555555);
	i = (i & 0x33333333) + ((i >>> 2) & 0x33333333);
	i = (i + (i >>> 4)) & 0x0f0f0f0f;
	i = i + (i >>> 8);
	i = i + (i >>> 16);
	return i & 0x3f;
};

export function tryParseUint31(s) {
	/* parse a string representing a 31-bit int of the form ^(0|[1-9][0-9]*)$
	returns the integer, or any negative integer if the string was malformed */

	dbg && assert.str(s);
	let len = s.length;
	let lenNibble = len & 0b1111; /* prevent excessive iteration */
	let c0 = s.charCodeAt(0) - 48;

	let invalid =
		(lenNibble === 0)
		| (len > 10)
		| ((c0 >>> 1) > 4) /* c0 < 0 || c0 > 9 */
		| ((c0 << 3) < (lenNibble >>> 1)) /* c0 === 0 && lenNibble !== 1 */
		| (lenNibble === 10 && s > `2147483647`);

	let n = c0;
	for (let i = 1; i < lenNibble; ++i) {
		let c = s.charCodeAt(i) - 48;
		n = Math.imul(10, n) + c;
		invalid |= ((c >>> 1) > 4); /* c < 0 || c > 9 */
	};

	return n | -invalid;
};

export const queueMicrotask =
	(typeof self.queueMicrotask === `function`)
		? self.queueMicrotask.bind(null)
		: (p => function queueMicrotask(callback) {
			return p.then(callback);
		})(Promise.resolve());

export function tryParseHref(href) {
	try {
		return new URL(href);
	} catch (x) {
		return null;};
};

export function isSafeUrl(url) {
	/* http(s) only, no credentials */
	if (url instanceof URL) {
		let p = url.protocol;
		return (p === `http:` || p === `https:`)
			&& url.host !== ``
			&& url.username === `` && url.password === ``;
	};
	return false;
};

/* attempt to detect decimal point and group separator characters
from current locale: */
const numFormat = (nf => {
	let sep = `,`;
	{
		let s = nf.format(0x7fffffff);
		let i = s.search(/[^0-9]/u);
		if (i >= 0) {
			sep = String.fromCodePoint(s.codePointAt(i));};
	};

	let pt = `.`;
	{
		let s = nf.format(0.1);
		let i = s.search(/[^0-9]/u);
		if (i >= 0) {
			pt = String.fromCodePoint(s.codePointAt(i));};
	};

	return {sep, pt};
})(new Intl.NumberFormat(undefined, {numberingSystem : `latn`}));
export const numGroupSeparator = numFormat.sep;
export const numDecimalPoint = numFormat.pt;

export function ensureSubMap(m, k) {
	dbg && assert(m instanceof Map);
	let sub = m.get(k);
	if (sub === undefined) {
		sub = new Map;
		m.set(k, sub);
	};
	dbg && assert(sub instanceof Map);
	return sub;
};

export function getFromSubMap(m, k1, k2) {
	dbg && assert(m instanceof Map);
	let sub = m.get(k1);
	if (sub !== undefined) {
		dbg && assert(sub instanceof Map);
		return sub.get(k2);
	};
	return undefined;
};

/* --- assertion --- */

let onAssertionFailure = () => {};
export function assignOnAssertionFailure(f) {onAssertionFailure = f;};

export function assert(value, message) {
	if (!value) {
		if (message == null) {
			message = `value was falsey`;
		} else if (message instanceof Error) {
			throw message;};
		debugger;
		onAssertionFailure();
		throw new Error(message);
	};
	return value;
};

function assertInternal(x, actual, stackStartFn = assertInternal) {
	let result =
		typeof x === `function`
			? x(actual)
			: typeof actual === x;

	if (!result) {
		let err = new TypeError(
			typeof x === `function`
				? `value did not satisfy predicate ${x.name}`
				: `value was not of type ${x}`);
		if (typeof Error.captureStackTrace === `function`) {
			Error.captureStackTrace(err, stackStartFn);};
		debugger;
		onAssertionFailure();
		throw err;
	};

	return actual;
};

assert.type = function assertType(t, actual) {
	return assertInternal(t, actual, assertType);
};

assert.str = function assertStr(x) {
	return assertInternal(`string`, x, assertStr);};

assert.num = function assertNum(x) {
	return assertInternal(`number`, x, assertNum);};

assert.obj = function assertObj(x) {
	return assertInternal(
		v => (typeof v === `object` && v !== null),
		x, assertObj);
};

assert.objOrNull = function assertObjOrNull(x) {
	return assertInternal(`object`, x, assertObjOrNull);};

assert.fn = function assertFn(x) {
	return assertInternal(`function`, x, assertFn);};

assert.sym = function assertSym(x) {
	return assertInternal(`symbol`, x, assertSym);};

assert.bool = function assertBool(x) {
	return assertInternal(`boolean`, x, assertBool);};

assert.bigInt = function assertBigInt(x) {
	return assertInternal(`bigint`, x, assertBigInt);};

assert.undef = function assertUndef(x) {
	return assertInternal(`undefined`, x, assertUndef);};

assert.int32 = function assertInt32(x) {
	return assertInternal(isInt32, x, assertInt32);};

assert.uint31 = function assertUint31(x) {
	return assertInternal(v => isInt32(v) && v >= 0, x, assertUint31);};

assert.safeInt = function assertSafeInt(x) {
	return assertInternal(Number.isSafeInteger, x, assertSafeInt);};

assert.sequ = function assertSequ(x) {
	return assertInternal(isIterable, x, assertSequ);};

assert.arr = function assertArr(x) {
	return assertInternal(Array.isArray, x, assertArr);};

assert.arrOrNull = function assertArrOrNull(x) {
	return assertInternal(
		v => (v === null || Array.isArray(v)),
		x, assertArrOrNull);
};

assert.asyncSequ = function assertAsyncSequ(x) {
	return assertInternal(isAsyncIterable, x, assertAsyncSequ);};

/* --- logging --- */

export function log(...xs) {
	console.log(`[${namespace}]`, ...xs);
};

log.warn = function logWarn(...xs) {
	console.warn(`[${namespace}]`, ...xs);
};

log.error = function logError(...xs) {
	console.error(`[${namespace}]`, ...xs);
};

log.debug = function logDebug(...xs) {
	dbg && console.debug(`[${namespace}]`, ...xs);
};

Object.freeze(log);

/* --- chainable exceptions --- */

function errorClass(baseClass) {
	return class extends baseClass {
		constructor(msg, innerXcep) {
			super(msg);

			if (typeof Error.captureStackTrace === `function`) {
				Error.captureStackTrace(this, this.constructor);};

			if (innerXcep !== undefined) {
				if (typeof innerXcep !== `object`
					|| !(innerXcep instanceof Error))
				{
					log.warn(`GalkError instanciated with invalid `+
						`inner error object (${innerXcep})`);
				} else {
					this.stack += `\ncaused by → ${innerXcep.name}: `
						+`${innerXcep.message}\n`
						+`${innerXcep.stack}`;
				};
			};
		};
	};
};

export const GalkError = errorClass(Error);
export const GalkTypeError = errorClass(TypeError);
export const GalkRangeError = errorClass(RangeError);

/* --- sequence functions --- */

const iterDoneRv = Object.freeze({done : true, value : undefined});
function iterRv(value) {
	return {done : false, value};
};

export function first(xs, pred = () => true, elseVal = undefined) {
	dbg && assert.sequ(xs);
	dbg && assert.fn(pred);

	for (let value, iter = xs[Symbol.iterator]();
		!({value} = iter.next()).done;)
	{
		if (pred(value)) {
			return value;};
	};

	return elseVal;
};

export function single(xs, pred = () => true, elseVal = undefined) {
	dbg && assert.sequ(xs);
	dbg && assert.fn(pred);

	let rv = elseVal;
	let found = false;
	for (let value, iter = xs[Symbol.iterator]();
		!({value} = iter.next()).done;)
	{
		if (pred(value)) {
			if (found) {
				return elseVal;
			} else {
				rv = value;
				found = true;
			};
		};
	};

	return rv;
};

const chainIterProto = {
	next() {
		while (this.idx < this.xss.length) {
			if (this.subIter === null) {
				this.subIter =
					this.xss[this.idx][Symbol.iterator]();};

			let next = this.subIter.next();
			if (!next.done) {
				return next;};

			this.subIter = null;
			++this.idx;
		};

		return iterDoneRv;
	},

	[Symbol.iterator]() {return this;},
};

const chainResultProto = {
	[Symbol.iterator]() {
		return {
			__proto__ : chainIterProto,
			xss : this.xss,
			idx : 0,
			subIter : null,};
	},
};

export function chainFrom(xss) {
	dbg && assert.arr(xss);
	dbg && xss.every(assert.sequ);
	return {
		__proto__ : chainResultProto,
		xss,};
};

export function chain(...xss) {
	return chainFrom(xss);
};

const filterIterProto = {
	next() {
		while (!this.done) {
			let next = this.xsIter.next();
			if (next.done) {
				this.done = next.done;
				return next;
			} else if (this.pred(next.value)) {
				return next;};
		};
		return iterDoneRv;
	},

	[Symbol.iterator]() {return this;},
};

const filterResultProto = {
	[Symbol.iterator]() {
		return {
			__proto__ : filterIterProto,
			xsIter : this.xs[Symbol.iterator](),
			pred : this.pred,
			done : false,};
	},
};

export function filter(xs, pred) {
	dbg && assert.sequ(xs);
	return {
		__proto__ : filterResultProto,
		xs,
		pred,};
};

const mapIterProto = {
	next() {
		let next = this.iter.next();
		if (next.done) {return next;};

		return iterRv(this.f(next.value));
	},

	[Symbol.iterator]() {return this;},
};

const mapResultProto = {
	[Symbol.iterator]() {
		return {
			__proto__ : mapIterProto,
			iter : this.xs[Symbol.iterator](),
			f : this.f,};
	},
};

export function map(xs, f) {
	dbg && assert.sequ(xs);
	return {
		__proto__ : mapResultProto,
		xs,
		f,};
};

export function every(xs, pred) {
	dbg && assert.sequ(xs);
	dbg && assert(typeof pred === `function`);

	for (let value, it = xs[Symbol.iterator](); !({value} = it.next()).done;) {
		if (!pred(value)) {return false;};};

	return true;
};

export function some(xs, pred) {
	dbg && assert.sequ(xs);

	if (pred === undefined) {
		return !xs[Symbol.iterator]().next().done;};

	dbg && assert(typeof pred === `function`);

	for (let value, it = xs[Symbol.iterator](); !({value} = it.next()).done;) {
		if (pred(value)) {return true;};};

	return false;
};

export function count(xs, upTo = Infinity) {
	let len = lengthOf(xs);
	if (len >= 0) {
		return len;};

	dbg && assert.sequ(xs);
	dbg && assert(typeof upTo === `number`);

	len = 0;
	for (const iter = xs[Symbol.iterator]();
		len < upTo && !iter.next().done;
		++len) {};
	return len;
};

const enumerateIterProto = {
	next() {
		let next = this.iter.next();
		if (next.done) {return next;};

		return iterRv([this.i++, next.value]);
	},

	[Symbol.iterator]() {return this;},
};

const enumerateResultProto = {
	[Symbol.iterator]() {
		return {
			__proto__ : enumerateIterProto,
			iter : this.xs[Symbol.iterator](),
			i : this.i,};
	},
};

export function enumerate(xs, start = 0) {
	dbg && assert.sequ(xs);
	dbg && assert.num(start);

	return {
		__proto__ : enumerateResultProto,
		xs,
		i : start,};
};

export function joinString(xs, sep) {
	dbg && assert.sequ(xs);

	let s = ``;

	const iter = xs[Symbol.iterator]();
	let next;

	if (sep === undefined) {
		while (!(next = iter.next()).done) {
			s += next.value;};
	} else {
		next = iter.next();
		if (!next.done) {
			s += next.value;
			const sepStr = `${sep}`;
			while (!(next = iter.next()).done) {
				s += sepStr+next.value;};
		};
	};

	return s;
};

const subseqIterProto = {
	_initialise() {
		this.initialised = true;
		let {start, end, xs} = this;

		if (this.len >= 0) {
			/* known length (assumes .length is correct) */

			if (start < end) {
				let iter = xs[Symbol.iterator]();

				/* advance iter to start offset: */
				for (let i = 0; i < start; ++i) {
					iter.next();};

				this.n = end - start;
				this.iter = iter;
			};

		} else {
			let iter = xs[Symbol.iterator]();

			/* advance iter to start offset: */
			let skipN = Math.min(start, Infinity * (end - start));
			let i = 0;
			for (; i < skipN; ++i) {
				let next = iter.next();
				if (next.done) {
					/* reached the end of the source;
					ensure next() is not called again */
					i = end;
					this.doneNext = next;
					break;
				};
			};
			this.n = end - i;
			this.iter = iter;
		};
	},

	next() {
		if (!this.initialised) {
			this._initialise();};

		if (this.n > 0) {
			let rv = this.iter.next();
			--this.n;
			if (rv.done) {
				this.n = 0;
				this.doneNext = rv;
			};
			return rv;
		} else {
			return this.doneNext;};
	},

	[Symbol.iterator]() {return this;},
};

const subseqResultProto = {
	get length() {
		return this.len >= 0 ? this.len : undefined;
	},

	[Symbol.iterator]() {
		return {
			__proto__ : subseqIterProto,
			initialised : false,
			xs : this.xs,
			n : 0,
			iter : null,
			doneNext : iterDoneRv,
			start : this.start,
			end : this.end,
			len : this.len,};
	},
};

export function subseq(xs, start = 0, end = Infinity) {
	dbg && assert.sequ(xs);
	dbg && assert.num(start);
	dbg && assert.num(end);

	start = Math.trunc(start);
	end = Math.trunc(end);

	let len = lengthOf(xs);
	if (len >= 0) {
		start = normaliseIntSliceTerm(start, len);
		end = normaliseIntSliceTerm(end, len);
		len = start < end ? end - start : 0;
	} else if (start < 0 || end < 0) {
		throw new RangeError(`can't slice a sequence of unknown length `
			+`using negative indices`);};

	return {
		__proto__ : subseqResultProto,
		xs,
		start,
		end,
		len,};
};

function normaliseIntSliceTerm(val, len) {
	dbg && assert.safeInt(len && len >= 0);

	let n = +val;

	if (!(n >= 0)) {
		n += len;
		if (!(n >= 0)) {
			n = 0;};
	} else if (n > len) {
		n = len;};

	return n;
};

const iotaIterProto = {
	next() {
		let rv = {
			value : this.i,
			done :
				this.up
					? !(this.i < this.end)
					: !(this.i > this.end)};

		if (!rv.done) {
			this.i += this.step;};

		return rv;
	},

	[Symbol.iterator]() {return this;},
};

const iotaResultProto = {
	[Symbol.iterator]() {
		return {
			__proto__ : iotaIterProto,
			i : this.begin,
			end : this.end,
			step : this.step,
			up : this.begin < this.end,};
	},
};

export function iota(begin, end, step = 1) {
	/* iota(x) is equivalent to iota(0, x) */
	if (end === undefined) {
		dbg && assert(begin >= 0);
		end = begin;
		begin = 0;};

	dbg && assert.num(step);
	dbg && assert.num(begin);
	dbg && assert.num(end);

	return {
		__proto__ : iotaResultProto,
		begin, end, step,};
};

/* --- sorting --- */

export function defaultCompare(v1, v2) {
	return Object.is(v1, v2) ? 0 : (v1 < v2 ? -1 : 1);
};

export function compareArrays(xs, ys, compare = defaultCompare) {
	/* returns 0 or <0 or >0 */
	dbg && assert(hasLength(xs));
	dbg && assert(hasLength(ys));
	dbg && assert.fn(compare);

	if (xs === ys) {return 0;};

	let nX = xs.length;
	let nY = ys.length;
	for (let i = 0, n = Math.min(nX, nY); i < n; ++i) {
		let d = compare(xs[i], ys[i]);
		if (d !== 0) {return d;};
	};

	return nX - nY;
};

export function sort(xs, compare) {
	dbg && assert.sequ(xs);

	let arr = Array.from(xs);
	arr.sort(compare);

	// todo:
	// reimplement as drain to binary-heap followed by lazy sorting ?

	return arr;
};

/* --- sorted set --- */

/* structure:
	root: branch
	branch: {branchBmp : int32, leafBmp : int32, subs : [sub, sub, ...]}
	sub: entry | branch
	entry: any value except `undefined`
	key: Uint8Array

entries are sorted according to their key, which is `keyFor(entry)`.
keys are Uint8Arrays of any length. entries with the same key are
considered equivalent.
keys are interpreted as a sequence of 5-bit units. bits outside the bounds of
the array are considered zero. each subsequent unit corresponds to the depth
in the tree at which those bits apply.

a branch can have 2 to 32 subs, except the root which can have 0 to 32.
a branch may be either a regular branch or a collisison branch.
in a regular branch, `leafBmp` and `branchBmp` are bitmaps where each bit
indicates the presence of a key with the corresponding 5-bit unit (equal to
the bit's position). the `subs` array contains one element for every `1` bit
in `leafBmp|branchBmp`. the two bitmaps indicate which of the subs are
entries and which are sub-branches, respectively.

//
(todo: more details)

[leaf,leaf] collision; branchBmp: ~0, leafBmp: ~bit
[leaf,branch] collision; branchBmp: ~bit, leafBmp: ~bit

*/

export function createSortedSet() {
	return bitTrieCreateEmptyBranch();
};

function bitTrieCreateEmptyBranch() {
	return {branchBmp : 0, leafBmp : 0, subs : []};
};

export function iterateSortedSet(root) {
	/* note: mutating the tree during iteration leads to undefined behaviour */
	return {
		__proto__ : sortedSetIterProto,
		state : {branch : root, i : -1, bit : 0},
		stack : [],};
};

const sortedSetIterProto = {
	next() {
		while (true) {
			if (this.state === null) {
				return {value : undefined, done : true};};

			let {state} = this;
			dbg && bitTrieAssertBranch(state.branch);
			let {subs, branchBmp, leafBmp} = state.branch;

			if (bitTrieIsCollisionBmps(branchBmp, leafBmp)) {
				++state.i;
				if (state.i === 0) {
					/* subs[0] is always a leaf */
					return {value : subs[0], done : false};

				} else {
					dbg && assert(state.i === 1);
					if (branchBmp === ~0) {
						/* subs[1] is a leaf */
						this.state = this.stack.pop() || null;
						return {value : subs[1], done : false};
					} else {
						/* subs[1] is a branch */
						this.state = {branch : subs[1], bit : 0, i : -1};
						dbg && bitTrieAssertBranch(this.state.branch);
						continue;
					};
				};
			} else {
				let n = subs.length;
				++state.i;
				dbg && assert(state.i <= n);

				if (state.i === n) {
					/* branch depleted */
					this.state = this.stack.pop() || null;
					continue;
				} else {
					if (state.bit === 0) {
						state.bit = bitTrieLowestBit(branchBmp, leafBmp);
					} else {
						state.bit = bitTrieHigherBit(
							branchBmp, leafBmp, state.bit);};

					if ((state.bit & leafBmp) !== 0) {
						/* subs[i] is a leaf */
						return {value : subs[state.i], done : false};
					} else {
						dbg && assert((state.bit & branchBmp) !== 0);
						/* subs[i] is a branch */
						this.stack.push(state);
						this.state = {branch : subs[state.i], bit : 0, i : -1};
						dbg && bitTrieAssertBranch(this.state.branch);
						continue;
					};
				};
			};

			assert(false, `unreachable`);
		};
	},

	[Symbol.iterator]() {return this;},
};

export function operateSortedSet(root, {
	operate, /* (entry|undef, next|undef) => entry|undef */
	atKey, /* bytes */
	keyFor, /* (entry) => bytes */})
{
	/* rules:
		• entries can't be `undefined`
		• once an entry is inserted,
			keyFor(entry) must always yield the same key
		• if `operate` updates an existing entry,
			keyFor(newEntry) must equal keyFor(oldEntry)
		• if `operate` or `keyFor` throws an exception,
			the map remains unaltered
		• if any exception is thrown not originating from `operate` or `keyFor`,
			an error occurred and the map is in an undefined state
		• the map can't be mutated from inside `operate` (i.e. no reentrance)
	*/

	dbg && assert.fn(operate);
	dbg && assert.fn(keyFor);
	dbg && bitTrieAssertKey(atKey);
	if (dbg) {
		let f = keyFor;
		keyFor = x => {assert(x !== undefined); return f(x);};
	};

	let depth = 0;
	let branch = root;
	let nextSubtree = null; /* {branch, bit, i} | null */
	let parentBranch = null;
	while (true) {
		dbg && bitTrieAssertBranch(branch, {isRoot : branch === root});

		let {leafBmp, branchBmp} = branch;
		let bit = bitTrieKeyBit(atKey, depth);
		let i;

		if (bitTrieIsCollisionBmps(leafBmp, branchBmp)) {
			if (leafBmp !== ~bit) {
				/* atKey doesn't collide at this depth: */
				bitTrieOperateResolveCollision(branch,
					{atKey, bit, depth, nextSubtree, operate, keyFor});
				break;
			};
			/* atKey collides at this depth */

			if (branchBmp === ~0) {
				/* [leaf, leaf] collision: */
				bitTrieOperateTwoLeafCollision(branch, {
					atKey, bit, depth, nextSubtree, parentBranch, operate,
					keyFor});
				break;
			};
			/* [leaf, branch] collision */

			let leafDiff = bitTrieCompareKeys(
				atKey, keyFor(branch.subs[0]), depth);
			if (leafDiff < 0) {
				/* atKey belongs before leaf at subs[0]: */
				bitTrieOperateCollisionWithLeafAfterKey(branch,
					{bit, depth, operate, atKey, keyFor});
				break;
			} else if (leafDiff === 0) {
				/* atKey matches leaf at subs[0]: */
				bitTrieOperateCollisionWithLeafAtKey(branch,
					{bit, operate, atKey, keyFor});
				break;
			};
			dbg && assert(leafDiff > 0);

			/* search sub-branch: */
			i = 1;
			dbg && assert(branchBmp === ~bit);

		} else if ((bit & leafBmp) !== 0) {
			/* reached leaf: */
			bitTrieOperateBranchWithLeafAtKey(branch, {
				atKey, bit, depth, nextSubtree, parentBranch, operate, keyFor});
			break;

		} else if ((bit & branchBmp) === 0) {
			/* no matching leaf or sub-branch: */
			bitTrieOperateBranchWithNothingAtKey(branch,
				{atKey, bit, nextSubtree, operate, keyFor});
			break;

		} else {
			/* search sub-branch: */
			i = bitTrieIndex(branch, bit);

			let nextBit = bitTrieHigherBit(
				branch.branchBmp, branch.leafBmp, bit);
			if (nextBit !== 0) {
				dbg && assert(branch.subs.length > i + 1);
				nextSubtree = {branch, bit : nextBit, i : i + 1};
			};
		};

		dbg && assert(i < branch.subs.length);
		parentBranch = branch;
		branch = branch.subs[i];
		++depth;
	};

	dbg && bitTrieAssertBranch(root, {isRoot : true});
};

function bitTrieOperateBranchWithLeafAtKey(branch,
	{atKey, bit, depth, nextSubtree, parentBranch, operate, keyFor})
{
	dbg && assert(!bitTrieIsCollision(branch));
	dbg && assert((branch.leafBmp & bit) === bit);
	dbg && assert((branch.branchBmp & bit) === 0);

	let {subs} = branch;
	let i = bitTrieIndex(branch, bit);
	let leaf = subs[i];
	let kLeaf = keyFor(leaf);

	let diff = bitTrieCompareKeys(atKey, kLeaf, depth);

	let next;
	if (diff < 0) {
		next = leaf;
	} else {
		let nextBit = bitTrieHigherBit(branch.branchBmp, branch.leafBmp, bit);
		if (nextBit !== 0) {
			next = bitTrieSubtreeFirstEntry({branch, bit : nextBit, i : i + 1});
		} else {
			next = bitTrieSubtreeFirstEntry(nextSubtree);};
	};

	if (diff === 0) {
		/* atKey matches existing leaf */
		let entry = bitTrieOperate(leaf, next, {operate, atKey, keyFor});
		if (entry === undefined) {
			/* delete existing entry: */
			if (subs.length === 2) {
				/* `branch` is a two-sub branch */
				let sibling = subs[(i + 1) & 1];

				if (branch.branchBmp !== 0) {
					/* `sibling` is a branch */
					bitTrieElevateBranchInto(
						sibling, branch, branch.branchBmp);
					/* elevated sibling overwrites contents of `branch` */

				} else if (parentBranch === null) {
					dbg && assert(branch.leafBmp !== 0);
					/* `branch` is a two-sub root branch; `sibling` is a leaf */

					subs.splice(i, 1);
					branch.leafBmp &= ~bit;

				} else {
					dbg && assert(branch.leafBmp !== 0);
					/* `branch` is a two-sub non-root branch;
					`sibling` is a leaf */

					if (bitTrieIsCollision(parentBranch)) {
						dbg && assert(parentBranch.subs[1] === branch);

						parentBranch.branchBmp = ~0;
						parentBranch.subs[1] = sibling;

					} else {
						let bitP = bitTrieKeyBit(atKey, depth - 1);
						let iP = bitTrieIndex(parentBranch, bitP);

						/* sibling is a leaf */
						parentBranch.leafBmp |= bitP;
						parentBranch.branchBmp &= ~bitP;

						parentBranch.subs[iP] = sibling;
					};

					dbg && bitTrieAssertBranch(parentBranch);
				};

			} else {
				/* `branch` has three or more subs;
				delete the target leaf from it: */
				subs.splice(i, 1);
				branch.leafBmp &= ~bit;
			};

		} else {
			/* update existing entry: */
			subs[i] = entry;
		};
	} else {
		/* atKey doesn't match existing leaf */
		let entry = bitTrieOperate(undefined, next,
			{operate, atKey, keyFor});
		if (entry === undefined) {
			return; /* don't insert new entry */};

		if (subs.length === 1) {
			dbg && assert(parentBranch === null);
			/* `branch` is root, with one leaf;
			convert to a two-leaf branch: */
			if (diff < 0) {
				bitTrieCreateTwoLeafBranch(
					atKey, entry, kLeaf, leaf, depth, branch);
			} else {
				bitTrieCreateTwoLeafBranch(
					kLeaf, leaf, atKey, entry, depth, branch);};
		} else {
			/* replace leaf with branch: */
			let subBranch = diff < 0
				? bitTrieCreateTwoLeafBranch(
					atKey, entry, kLeaf, leaf, depth + 1)
				: bitTrieCreateTwoLeafBranch(
					kLeaf, leaf, atKey, entry, depth + 1);

			subs[i] = subBranch;
			branch.branchBmp |= bit;
			branch.leafBmp &= ~bit;
		};
	};

	dbg && bitTrieAssertBranch(branch);
};

function bitTrieOperateBranchWithNothingAtKey(branch,
	{atKey, bit, nextSubtree, operate, keyFor})
{
	dbg && assert(!bitTrieIsCollision(branch));

	let next;
	{
		let nextBit = bitTrieHigherBit(branch.branchBmp, branch.leafBmp, bit);
		if (nextBit !== 0) {
			next = bitTrieSubtreeFirstEntry(
				{branch, bit : nextBit, i : bitTrieIndex(branch, nextBit)});
		} else {
			next = bitTrieSubtreeFirstEntry(nextSubtree);};
	};

	let entry = bitTrieOperate(undefined, next, {operate, atKey, keyFor});
	if (entry === undefined) {
		return; /* don't inset new entry */};

	let i = bitTrieIndex(branch, bit);
	branch.subs.splice(i, 0, entry);
	branch.leafBmp |= bit;
};

function bitTrieOperateTwoLeafCollision(branch,
	{atKey, bit, depth, nextSubtree, parentBranch, operate, keyFor})
{
	/* [leaf, leaf] collision; atKey also collides at this depth: */
	dbg && assert(branch.leafBmp === ~bit);

	let {subs} = branch;
	let e0 = subs[0];
	let k0 = keyFor(e0);

	let diff = bitTrieCompareKeys(atKey, k0, depth);
	if (diff < 0) {
		/* convert to a [leaf, branch] collision
		where `leaf` is the target entry */

		let entry = bitTrieOperate(undefined, e0 /* next */,
			{operate, atKey, keyFor});
		if (entry === undefined) {
			return; /* don't insert new entry */};

		let e1 = subs[1];
		let subBranch = bitTrieCreateTwoLeafBranch(
			k0, e0, keyFor(e1), e1, depth + 1);

		subs[0] = entry;
		subs[1] = subBranch;
		branch.branchBmp = ~bit;
		dbg && assert(branch.leafBmp === ~bit);

	} else if (diff > 0) {
		let e1 = subs[1];
		let k1 = keyFor(e1);

		diff = bitTrieCompareKeys(atKey, k1, depth);
		if (diff < 0) {
			/* target key belongs between subs[0] and subs[1] */

			let entry = bitTrieOperate(undefined, e1 /* next */,
				{operate, atKey, keyFor});
			if (entry === undefined) {
				return; /* don't insert new entry */};

			/* replace subs[1] with a branch of [entry, subs[1]]: */
			subs[1] = bitTrieCreateTwoLeafBranch(
				atKey, entry, k1, e1, depth + 1);

			branch.branchBmp = branch.leafBmp;

		} else if (diff > 0) {
			/* target key belongs after both subs */

			let entry = bitTrieOperate(undefined,
				bitTrieSubtreeFirstEntry(nextSubtree) /* next */,
				{operate, atKey, keyFor});
			if (entry === undefined) {
				return; /* don't insert new entry */};

			/* replace subs[1] with a branch of [subs[1], entry]: */
			subs[1] = bitTrieCreateTwoLeafBranch(
				k1, e1, atKey, entry, depth + 1);

			branch.branchBmp = branch.leafBmp;

		} else {
			dbg && assert(diff === 0);
			/* atKey matches subs[1] */
			return bitTriUpdateTwoLeafCollision(branch, 1, {
				depth, atKey, operate, keyFor, parentBranch,
				nextEntry : bitTrieSubtreeFirstEntry(nextSubtree)});
		};

	} else {
		dbg && assert(diff === 0);
		/* atKey matches subs[0] */
		return bitTriUpdateTwoLeafCollision(branch, 0, {
			depth, atKey, operate, keyFor, parentBranch,
			nextEntry : subs[1]});
	};
};

function bitTriUpdateTwoLeafCollision(branch, i,
	{depth, nextEntry, parentBranch, atKey, operate, keyFor})
{
	dbg && bitTrieAssertBranch(branch, {isRoot : parentBranch === null});
	/* operate the leaf at subs[i]: */

	let {subs} = branch;
	let entry = bitTrieOperate(subs[i], nextEntry,
		{operate, atKey, keyFor});

	if (entry === undefined) {
		/* delete existing entry: */

		if (parentBranch === null) {
			/* this is the root branch; convert to non-collision: */
			branch.branchBmp = 0;
			branch.leafBmp = ~branch.leafBmp;
			subs.splice(i, 1);

			dbg && bitTrieAssertBranch(branch, {isRoot : true});

		} else {
			let sibling = subs[(i + 1) & 1];

			/* replace branch with sibling, in parent: */
			if (bitTrieIsCollision(parentBranch)) {
				dbg && assert(parentBranch.subs[1] === branch);
				parentBranch.subs[1] = sibling;
				parentBranch.branchBmp = ~0;

			} else {
				let bitP = bitTrieKeyBit(atKey, depth - 1);
				parentBranch.leafBmp |= bitP;
				parentBranch.branchBmp &= ~bitP;

				let iP = bitTrieIndex(parentBranch, bitP);
				parentBranch.subs[iP] = sibling;
			};

			dbg && bitTrieAssertBranch(parentBranch);
		};

	} else {
		/* update existing entry: */
		subs[i] = entry;
	};
};

function bitTrieOperateResolveCollision(branch,
	{atKey, bit, depth, nextSubtree, operate, keyFor})
{
	/* `bit` matches neither subs;
	subs are either [leaf, leaf] or [leaf, branch] */

	let clBit = ~branch.leafBmp;
	dbg && assert(bit !== clBit);

	let next = bit < clBit
		? branch.subs[0]
		: bitTrieSubtreeFirstEntry(nextSubtree);

	let entry = bitTrieOperate(undefined, next,
		{operate, atKey, keyFor});
	if (entry === undefined) {
		return; /* don't insert new entry */};

	let {subs} = branch;
	let [e0, e1] = subs;
	let subBranch =
		branch.branchBmp === ~0
			? bitTrieCreateTwoLeafBranch(/* descend [leaf, leaf] */
				keyFor(e0), e0, keyFor(e1), e1, depth + 1)
			: bitTrieLowerBranch(/* descend [leaf, branch] */
				branch, depth + 1, keyFor);

	dbg && bitTrieAssertBranch(subBranch, {isRoot : false});

	if (bit < clBit) {
		subs[0] = entry;
		subs[1] = subBranch;
	} else {
		subs[0] = subBranch;
		subs[1] = entry;};

	branch.leafBmp = bit
	branch.branchBmp = clBit
};

function bitTrieOperateCollisionWithLeafAtKey(branch,
	{bit, atKey, operate, keyFor})
{
	dbg && assert(branch.branchBmp === branch.leafBmp);
	dbg && assert(branch.leafBmp === ~bit);
	/* atKey matches subs[0] and subs[1] is a branch */

	let {subs} = branch;

	let sibling = subs[1];
	dbg && bitTrieAssertBranch(sibling, {isRoot : false});

	let entry = bitTrieOperate(subs[0], bitTrieFirstEntry(sibling) /* next */,
		{operate, atKey, keyFor});

	if (entry === undefined) {
		/* delete existing entry by elevating sibling branch into `branch`: */
		bitTrieElevateBranchInto(sibling, branch, bit);
		dbg && bitTrieAssertBranch(branch);
	} else {
		subs[0] = entry;
	};
};

function bitTrieOperateCollisionWithLeafAfterKey(branch,
	{bit, depth, atKey, operate, keyFor})
{
	dbg && assert(branch.branchBmp === branch.leafBmp);
	dbg && assert(branch.leafBmp === ~bit);
	/* atKey belongs before subs[0] and subs[1] is a branch */

	let {subs} = branch;
	dbg && bitTrieAssertBranch(subs[1], {isRoot : false});

	let next = subs[0];
	let entry = bitTrieOperate(undefined, next, {operate, atKey, keyFor});
	if (entry === undefined) {
		/* don't insert new entry */
	} else {
		/* move `next` into sub-branch: */
		bitTriePrependUnique(subs[1],
			{entry : next, depth : depth + 1, keyFor});

		subs[0] = entry;
	};
};

function bitTrieFirstEntry(branch) {
	if (branch === null) {
		return undefined;};

	while (true) {
		dbg && bitTrieAssertBranch(branch);

		let {branchBmp, leafBmp} = branch;
		if (bitTrieIsCollisionBmps(branchBmp, leafBmp)) {
			return branch.subs[0];};

		let bit = bitTrieLowestBit(branchBmp, leafBmp);

		if ((bit & leafBmp) !== 0) {
			return branch.subs[0];};

		dbg && assert((bit & branchBmp) !== 0);
		branch = branch.subs[0];
	};
};

function bitTrieSubtreeFirstEntry(st) {
	if (st === null) {
		return undefined;};

	let {branch, bit, i} = st;
	dbg && bitTrieAssertBranch(branch);
	dbg && assert(i >= 0);

	let {branchBmp, leafBmp} = branch;
	if (bitTrieIsCollisionBmps(branchBmp, leafBmp)) {
		dbg && assert(i < 1);
		if (i === 1 && branchBmp !== ~0) {
			return bitTrieFirstEntry(branch.subs[i]);
		} else {
			return branch.subs[i];};
	};

	dbg && assert(isBit(bit));

	if ((bit & leafBmp) !== 0) {
		return branch.subs[i];};

	dbg && assert((bit & branchBmp) !== 0);
	return bitTrieFirstEntry(branch.subs[i]);
};

function bitTrieCreateTwoLeafBranch(
	k0, e0, k1, e1, depth, dest = bitTrieCreateEmptyBranch())
{
	dbg && assert.obj(dest);
	dbg && assert(bitTrieCompareKeys(k0, k1, depth) < 0,
		`provided entries must be ordered`);

	let bit0 = bitTrieKeyBit(k0, depth);
	let bit1 = bitTrieKeyBit(k1, depth);
	if (bit0 === bit1) {
		/* create collision */
		dest.branchBmp = ~0;
		dest.leafBmp = ~bit0;
	} else {
		dbg && assert(bit0 < bit1);
		/* create normal branch */
		dest.branchBmp = 0;
		dest.leafBmp = bit0|bit1;
	};

	let {subs} = dest;
	subs.length = 2;
	subs[0] = e0;
	subs[1] = e1;
	return dest;
};

function bitTrieLowerBranch(branch, newDepth, keyFor) {
	/* note: must not mutate any existing branches
	(in case `keyFor` throws an exception) */

	dbg && assert.uint31(newDepth);
	dbg && assert.fn(keyFor);

	let newBr = bitTrieCreateEmptyBranch();

	/* iterate every entry in `branch` in reverse order
	and prepend them to `newBr`: */

	let stack = [];
	let bit = 0;
	let i = 0;

	outer : while (true) {
		dbg && bitTrieAssertBranch(branch);
		let {subs, branchBmp, leafBmp} = branch;

		if (bitTrieIsCollisionBmps(branchBmp, leafBmp)) {
			--i;
			if (i === -1) {
				if (branchBmp === ~0) {
					/* subs[1] is a leaf */
					bitTriePrependUnique(newBr, {
						entry : subs[1], depth : newDepth, keyFor});
				} else {
					/* subs[1] is a branch */
					stack.push({branch, bit, i});
					branch = subs[1];
					bit = 0;
					i = 0;
					continue outer;
				};
			};

			/* subs[0] is always a leaf */
			bitTriePrependUnique(newBr, {
				entry : subs[0], depth : newDepth, keyFor});

		} else {
			let n = subs.length;
			while (true) {
				dbg && assert(bit === 0 || isBit(bit));
				bit = bitTrieHighestBit(/* greatest bit less than `bit` */
					branchBmp & (bit - 1), leafBmp & (bit - 1));
				if (bit === 0) {break;};

				i = (i - 1 + n) % n;
				dbg && assert(i >= 0 && i < n);

				if ((bit & leafBmp) !== 0) {
					/* subs[i] is a leaf */
					bitTriePrependUnique(newBr,
						{entry : subs[i], depth : newDepth, keyFor});
				} else {
					dbg && assert((bit & branchBmp) !== 0);
					/* subs[i] is a branch */
					stack.push({branch, bit, i});
					branch = subs[i];
					bit = 0;
					i = 0;
					continue outer;
				};
			};
		};

		if (stack.length === 0) {break;};
		({branch, bit, i} = stack.pop());
	};

	return newBr;
};

function bitTriePrependUnique(branch, {entry, depth, keyFor}) {
	/* the entry must be less than any existing entries in the tree;
	if `keyFor` throws an exception, the tree remains unaltered */

	dbg && bitTrieAssertBranch(branch);
	dbg && assert.fn(keyFor);
	let k = keyFor(entry);

	while (true) {
		let {leafBmp, branchBmp, subs} = branch;
		let bit = bitTrieKeyBit(k, depth);
		let i;

		if (bitTrieIsCollisionBmps(leafBmp, branchBmp)) {
			/* k belongs before leaf at subs[0] */
			if (branchBmp === ~0) {
				/* [leaf, leaf] collision;
				move existing entries to new sub-branch: */
				let e0 = subs[0];
				let e1 = subs[1];
				let subBranch = bitTrieCreateTwoLeafBranch(
					keyFor(e0), e0, keyFor(e1), e1, depth + 1);

				subs[0] = entry;
				subs[1] = subBranch;
				if (leafBmp === ~bit) {
					branch.branchBmp = branch.leafBmp;
				} else {
					/* k doesn't collide at this depth;
					convert the branch from collision to regular branch: */
					branch.branchBmp = ~branch.leafBmp;
					branch.leafBmp = bit;
					dbg && assert(bit < branch.branchBmp);
				};
			} else {
				/* [leaf, branch] collision;
				move existing leaf into the sub-branch: */
				bitTriePrependUnique(subs[1],
					{entry : subs[0], depth : depth + 1, keyFor});

				/* must be recursive, otherwise exceptions thrown from `keyFor`
				could leave the tree in an invalid state */

				subs[0] = entry;
				if (leafBmp !== ~bit) {
					/* k doesn't collide at this depth;
					convert the branch from collision to regular branch: */
					branch.branchBmp = ~branch.branchBmp;
					branch.leafBmp = bit;
					dbg && assert(bit < branch.branchBmp);
				};
			};

			break;

		} else if ((bit & leafBmp) !== 0) {
			dbg && assert((leafBmp & (bit - 1)) === 0);
			/* reached leaf */

			if (subs.length === 1) {
				dbg && assert(leafBmp === bit);
				/* `branch` resembles a root, with one leaf;
				convert to a two-leaf collision: */
				subs.unshift(entry);
				branch.leafBmp = ~bit;
				branch.branchBmp = ~0;

			} else {
				/* replace with new branch: */

				let leaf = subs[0];
				let kLeaf = keyFor(leaf);
				let subBranch = bitTrieCreateTwoLeafBranch(
					k, entry, kLeaf, leaf, depth + 1);

				subs[0] = subBranch;
				branch.branchBmp |= bit;
				branch.leafBmp &= ~bit;
			};

			break;

		} else if ((bit & branchBmp) === 0) {
			/* no matching sub-branch; insert new entry: */
			subs.unshift(entry);
			branch.leafBmp |= bit;
			break;
		};

		dbg && assert((branchBmp & bit) !== 0);
		dbg && assert((branchBmp & (bit - 1)) === 0);
		/* search sub-branch: */
		branch = subs[0];
		++depth;
	};

	dbg && bitTrieAssertBranch(branch);
};

export const _bitTrieElevateBranchInto = bitTrieElevateBranchInto; // testing

function bitTrieElevateBranchInto(branch, dest, bit) {
	/* `branch` is the sub-branch of a parent which now has no other subs;
	`dest` needs to fill the position by extracting entries from `branch`
	and using them to populate `dest`;
	`dest` will be a collision branch with either two leaves
	(leaving `branch` empty) or a leaf and a sub-branch (which is `branch`)

	`bit` is the position where `branch` was previously attached */

	dbg && assert(branch !== dest);
	dbg && assert.obj(dest);
	dbg && assert.arr(dest.subs);
	dbg && assert(isBit(bit));

	/* `dest` is a dead branch we will overwrite the contents of;
	prepare it as a collision branch: */

	dest.leafBmp = ~bit;
	dest.branchBmp = ~bit;
	dest.subs.length = 2;

	dest.subs[0] = bitTrieExtractFirstEntry(branch, dest, bit, 1);
};

function bitTrieExtractFirstEntry(branch, parent, bitP, iP) {
	dbg && bitTrieAssertBranch(branch);
	dbg && bitTrieAssertBranch(parent);

	/* delete the first entry from `branch` and return it;
	`branch` itself may collapse into a leaf in the process

	`bitP` is the position bit where `branch` is attached
	`iP` is the index where `branch` is attached */

	let {branchBmp, leafBmp, subs} = branch;

	if (bitTrieIsCollisionBmps(branchBmp, leafBmp)) {
		let e0 = subs[0];
		if (branchBmp === ~0) {
			/* two-leaf collision; collapse into parent: */
			parent.subs[iP] = subs[1];
			bitTrieMoveSubBranchBitToLeafBit(parent, bitP);
			dbg && bitTrieAssertBranch(parent);
		} else {
			/* subs[1] is a sub-branch; elevate into `branch`: */
			subs[0] = bitTrieExtractFirstEntry(subs[1], branch, ~branchBmp, 1);
			dbg && bitTrieAssertBranch(branch);
		};

		return e0;

	} else {
		let bit = bitTrieLowestBit(branchBmp, leafBmp);
		let s0 = subs[0];

		if ((bit & leafBmp) !== 0) {
			/* first sub is a leaf */

			if (subs.length === 2) {
				if (branchBmp === 0) {
					/* second sub is a leaf;
					collapse branch into a leaf (last remaining entry): */
					parent.subs[iP] = subs[1];
					bitTrieMoveSubBranchBitToLeafBit(parent, bitP);
					dbg && bitTrieAssertBranch(parent);
				} else {
					/* second sub is a branch;
					replace the leaf at subs[0] with first entry
					from the sub-branch: */
					dbg && assert(isBit(branchBmp));
					subs[0] = bitTrieExtractFirstEntry(
						subs[1], branch,
						branchBmp, bitTrieIndex(branch, branchBmp));
					/* branch becomes a collision: */
					branch.leafBmp = ~branchBmp;
					branch.branchBmp = ~branch.branchBmp;
					dbg && bitTrieAssertBranch(branch);
				};
			} else {
				/* delete the leaf directly: */
				subs.splice(0, 1);
				branch.leafBmp &= ~bit;
				dbg && bitTrieAssertBranch(branch);
			};

			return s0;

		} else {
			dbg && assert((bit & branchBmp) !== 0);
			/* first sub is a branch */
			return bitTrieExtractFirstEntry(
				s0, branch, bit, bitTrieIndex(branch, bit));
		};
	};

	// todo: rewrite this algorithm non-recursively
};

function bitTrieMoveSubBranchBitToLeafBit(branch, bit) {
	if (bitTrieIsCollision(branch)) {
		branch.branchBmp = ~0;
		dbg && assert(branch.leafBmp === ~bit);
	} else {
		branch.branchBmp &= ~bit;
		branch.leafBmp |= bit;
	};
};

function bitTrieLowestBit(branchBmp, leafBmp) {
	let bit = (branchBmp|leafBmp) & -(branchBmp|leafBmp); /* lowest bit */
	dbg && assert(isBit(bit));
	return bit;
};

function bitTrieHighestBit(branchBmp, leafBmp) {
	let all = branchBmp|leafBmp;
	let bit = (1 << (31 - Math.clz32(all))) & all /* handles zero case */;
	dbg && assert(bit === 0 || bitTrieHigherBit(branchBmp, leafBmp, bit) === 0);
	return bit;
};

function bitTrieHigherBit(branchBmp, leafBmp, bit) {
	dbg && assert(isBit(bit));
	let nextBits = (branchBmp|leafBmp) & -(bit << 1); /* all bits after `bit` */
	return nextBits & -nextBits; /* lowest bit in `nextBits` */
};

function bitTrieKeyBit(bytes, depth) {
	dbg && bitTrieAssertKey(bytes);
	dbg && assert.uint31(depth);
	let bitIdx = depth * 5;
	let byteIdx = bitIdx >>> 3; /* idiv 8 */
	let offset = bitIdx & 0b111;

	let c = bytes[byteIdx] << 8; /* note: byteIdx might be out-of-bounds */
	if (offset > 3) {
		c |= bytes[byteIdx + 1];};

	return 1 << ((c >>> (11 - offset)) & 0b11111);
};

function bitTrieIndex(branch, bit) {
	dbg && assert(!bitTrieIsCollision(branch));
	dbg && assert(isBit(bit));
	/* array index of the element indicated by `bit`: */
	let i = int32Popcnt((branch.branchBmp|branch.leafBmp) & (bit - 1));
	dbg && assert(0 <= i && i < 32);
	return i;
};

function bitTrieCompareKeys(k1, k2, depth) {
	/* returns 0 or <0 or >0 */
	dbg && bitTrieAssertKey(k1);
	dbg && bitTrieAssertKey(k2);
	dbg && assert.uint31(depth);

	if (k1 === k2) {return 0;};

	let n1 = k1.length;
	let n2 = k2.length;

	for (let i = (depth * 5) >>> 3; i < n1 && i < n2; ++i) {
		let d = k1[i] - k2[i];
		if (d !== 0) {
			return d;};
	};

	return n1 - n2;
};

function bitTrieIsCollision({branchBmp, leafBmp}) {
	return (branchBmp & leafBmp) !== 0;
};

function bitTrieIsCollisionBmps(b0, b1) {
	return (b0 & b1) !== 0;
};

function bitTrieAssertKey(bytes) {
	assert(bytes instanceof Uint8Array);
};

function bitTrieAssertBranch(b, {isRoot} = {}) {
	assert.obj(b);
	let {branchBmp, leafBmp, subs} = b;

	assert.arr(subs);
	assert.int32(branchBmp);
	assert.int32(leafBmp);

	let n = subs.length;

	if (bitTrieIsCollision(b)) {
		assert(n === 2, `collisions must have two subs`);

		assert(isBit(~leafBmp));
		assert(branchBmp === ~0 /* [leaf, leaf] */
			|| branchBmp === leafBmp /* [leaf, branch] */);

	} else {
		if ((branchBmp | leafBmp) === 0) {
			assert(isRoot !== false && n === 0,
				`only the root branch can have zero subs`);
		} else {
			assert(int32Popcnt(branchBmp | leafBmp) === n);
			assert(n >= ((isRoot !== false) ? 1 : 2));
		};
	};
};

function bitTrieOperate(existing, next, {operate, atKey, keyFor}) {
	dbg && assert.fn(operate);
	let entry = operate(existing, next);

	dbg && (entry !== undefined
		&& assert(bitTrieCompareKeys(atKey, keyFor(entry), 0) === 0,
			`new entry doesn't match key`));

	return entry;
};

function isBit(bit) {
	/* bit = (1 << n) */
	return (bit & (bit - 1)) === 0;
};

/* --- string functions --- */

export const replacementChar = `\ufffd`;

const _whitespaceCodePoints = new Set([
	0x9, /* tab */
	0xa, /* lf */
	0xb, /* vtab */
	0xc, /* ff */
	0xd, /* cr */
	0x20, /* space */
	0x85, /* nel */
	0xa0, /* nbsp */
	0x1680, /* ogham space mark */
	0x2000, /* en quad */
	0x2001, /* em quad */
	0x2002, /* en space */
	0x2003, /* em space */
	0x2004, /* three-per-em space */
	0x2005, /* four-per-em space */
	0x2006, /* six-per-em space */
	0x2007, /* figure space */
	0x2008, /* punctuation space */
	0x2009, /* thin space */
	0x200a, /* hair space */
	0x2028, /* line separator */
	0x2029, /* paragraph separator */
	0x202f, /* narrow nbsp */
	0x205f, /* medium mathematical space */
	0x3000, /* ideographic space */]);

export const whitespaceCodePoints = Object.freeze([..._whitespaceCodePoints]);
/* all whitespace code-points are single code-units: */
dbg && assert(every(_whitespaceCodePoints, c => codePointLength(c) === 1));

export function codePointIsWhitespace(c) {
	return _whitespaceCodePoints.has(c|0);
};

export function codePointIsAscii(c) {
	return (c|0) <= 127;
};

export function codePointIsDigit(c) {
	return 48 <= (c|0) && (c|0) <= 57;
};

export function codePointIsUpperAlpha(c) {
	return 65 <= (c|0) && (c|0) <= 90;
};

export function codePointIsLowerAlpha(c) {
	return 97 <= (c|0) && (c|0) <= 122;
};

export function codePointIsGraphicalAscii(c) {
	return 33 <= (c|0) && (c|0) <= 126;
};
export function codePointIsLowerGraphicalAscii(c) {
	c = c|0;
	return (33 <= c && c <= 64) || (91 <= c && c <= 126);
};

export function codePointLength(c) {
	return (c|0) <= 0xffff ? 1 : 2
};

export function codePointLengthAt(s, i = 0) {
	/* returns 1 if not a valid surrogate pair or out of range */
	return surrogatePairCodePointAt(s, i) === -1 ? 1 : 2;
};

export function surrogatePairCodePointAt(s, i = 0) {
	/* returns -1 if not a valid surrogate pair or out of range */
	dbg && assert.str(s);
	dbg && assert.int32(i);

	let len = s.length;
	if (i + 2 > s.length) {
		return -1;};

	let first = s.charCodeAt(i);
	if (first >= 0xd800 && first <= 0xdbff) {/* high surrogate */
		let second = s.charCodeAt(i + 1);
		if (second >= 0xdc00 && second <= 0xdfff) {/* low surrogate */
			return (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000;};
	};

	return -1;
};

const tokeniseStringIterProto = {
	next() {
		dbg && assert.str(this.src);
		dbg && assert.int32(this.i);
		let len = this.src.length;

		while (this.i < len
			&& codePointIsWhitespace(this.src.codePointAt(this.i)))
		{
			++this.i;};

		if (this.i >= len) {
			return iterDoneRv;};

		let j = this.i;
		while (this.i < len
			&& !codePointIsWhitespace(this.src.codePointAt(this.i)))
		{
			++this.i;};

		dbg && assert(this.i > j);
		return {
			done : false,
			value : this.src.slice(j, this.i),
			beginIndex : j,
			endIndex : this.i,};
	},

	[Symbol.iterator]() {return this;},
};

const tokeniseStringResultProto = {
	[Symbol.iterator]() {
		return {
			__proto__ : tokeniseStringIterProto,
			src : this.src,
			i : 0,};
	},
};

export function tokeniseString(src) {
	dbg && assert.str(src);

	return {
		__proto__ : tokeniseStringResultProto,
		src,};
};

const stringCodePointsIterProto = {
	next() {
		let value = this.s.codePointAt(this.i);
		if (value !== undefined) {
			this.i += codePointLength(value);};
		return {value, done : value === undefined};
	},

	[Symbol.iterator]() {return this;},
};

const stringCodePointsResultProto = {
	[Symbol.iterator]() {
		return {
			__proto__ : stringCodePointsIterProto,
			s : this.s,
			i : 0,};
	},
};

export function stringCodePoints(s) {
	dbg && assert.str(s);
	return {__proto__ : stringCodePointsResultProto, s};
};

/* -------------------------------------------------------------------------- */

/*





















































*/

/* -------------------------------------------------------------------------- */