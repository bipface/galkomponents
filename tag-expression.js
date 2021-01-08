/* -------------------------------------------------------------------------- */

'use strict';

import * as common from './common.js';
const {
	dbg,
	assert,
	codePointLength,
	codePointLengthAt,
	codePointIsWhitespace,} = common;

/* -------------------------------------------------------------------------- */

export const kindSepChar = `:`;
export const wildcardChar = `*`;
export const emptyPlaceholder = `none`;
const escChar = `\\`;
const aposChar = `'`;
const dquoteChar = `"`;
const defaultQuoteChar = aposChar;

export const termOps = Object.freeze({
	include : ``,
	exclude : `-`,
	union : `~`,});

export function isTermOp(c) {
	return c === `` || c === `-` || c === `~`;
};

export function termOp(t) {
	dbg && assert.obj(t);
	if (t.op === undefined) {return ``;};
	return t.op;
};

export function termsEquiv(t1, t2) {
	/* no normalisation */
	dbg && assertTerm(t1);
	dbg && assertTerm(t2);
	return termOp(t1) === termOp(t2)
		&& t1.kind === t2.kind
		&& t1.value === t2.value;
};

export function assertTerm(t) {
	assert.obj(t);
	assert(isKind(t.kind), `invalid kind "${t.kind}"`);
	assert.str(t.value);
	if (t.op !== undefined) {
		assert(isTermOp(t.op));};
};

export function isKind(s) {
	dbg && assert.str(s);
	for (let i = 0, n = s.length; i < n;) {
		let cpt = s.codePointAt(i);
		if (!codePointIsIdentChar(cpt)) {
			return false;};
		i += codePointLength(cpt);
	};
	return true;
};

function kindIsIrremovable(k) {
	return k === `source` || k === `parent`
		|| k === `rating` || k === `embedded`;
};

export function normaliseAssignment(t) {
	if (kindIsIrremovable(t.kind) && t.op === termOps.exclude) {
		/* these props can't be deleted, only set to `none`: */
		return {kind : t.kind, op : termOps.include, value : emptyPlaceholder};
	};

	return normaliseTerm(t);
};

export function normaliseTerm(t) {
	dbg && assert.obj(t);
	let {kind, value, op} = t;
	dbg && assert.str(value);

	if (kind === `` /* tag */) {
		/* makes lowercase and replaces invalid characters with u+fffd */
		let changed = false;
		let norm = ``;
		for (let i = 0, n = value.length; i < n;) {
			let cpt = value.codePointAt(i);
			if (!common.codePointIsGraphicalAscii(cpt)) {
				norm += common.replacementChar;
				changed = true;
			} else {
				let ch = value[i];
				if (common.codePointIsUpperAlpha(cpt)) {
					norm += ch.toLowerCase();
					changed = true;
				} else {
					norm += ch;
				};
			};
			i += codePointLength(cpt);
		};

		if (changed) {
			return {kind, op, value : norm};};
		return t;

	} else {
		/* metatag */

		if (value === emptyPlaceholder) {
			return t;};

		if (value === `` || emptyPlaceholder.localeCompare(
			value, undefined, {sensitivity : `base`}) === 0)
		{
			return {kind, op, value : emptyPlaceholder};};

		if (kind === `parent` && value === `0`) {
			return {kind, op, value : emptyPlaceholder};};

		if (kind === `rating`) {
			let r = value[0].toLowerCase();
			if (value === r) {return t;};
			return {kind, op, value : r};
		};

		if (kind === `embedded`) {
			let v = value.toLowerCase();
			if (v === `t` || v === `yes` || v === 'y' ||
				v === `on` || v === `1`)
			{
				v = `true`;
			} else if (v === `f` || v === `no` || v === `n`
				|| v === `off` || v === `0`)
			{
				v = `false`;};

			if (value === v) {return t;};
			return {kind, op, value : v};
		};

		// todo: others (status, locked, etc.)

		return t;
	};
};

function codePointIsIdentChar(c) {
	c = c|0;
	return common.codePointIsDigit(c)
		|| common.codePointIsLowerAlpha(c)
		|| common.codePointIsUpperAlpha(c)
		|| c === 95 /* underscore */;
};

const parseTermsIterProto = {
	next() {
		let {xpr} = this;
		dbg && assert.str(xpr);
		let len = xpr.length;
		dbg && assert.int32(this.i);

		/* skip leading whitespace: */
		while (this.i < len
			&& codePointIsWhitespace(xpr.codePointAt(this.i)))
		{
			++this.i;};

		if (this.i >= len) {
			return {done : true};};

		let beginIndex = this.i;
		let iVal = beginIndex;

		/* parse operator: */
		let op = ``;
		switch (xpr[this.i]) {
			case termOps.exclude :
			case termOps.union :
				op = xpr[this.i];
				++this.i;
				++iVal;
				break;
			default : break;
		};

		if (op !== termOps.union) {
			/* parse metatag qualifier: */
			while (this.i < len
				&& codePointIsIdentChar(xpr.codePointAt(this.i)))
			{
				dbg && assert(codePointLengthAt(xpr, this.i) === 1);
				++this.i;
			};
		};

		let kind = ``;
		if (this.i < len
			&& this.i > iVal
			&& xpr[this.i] === kindSepChar)
		{
			kind = xpr.slice(iVal, this.i).toLowerCase();
			/* metatag prefix is always case-insensitive */
			++this.i;
			iVal = this.i;
		} else {
			/* unqualified term */
			this.i = iVal;
		};

		if (this.i < len && kind !== ``) {
			let quote = xpr[this.i];
			if (quote === aposChar || quote === dquoteChar) {
				++this.i;

				/* parse quoted value: */
				let val = ``;
				let hasWildcard = false;
				while (this.i < len) {
					let c = xpr[this.i];
					if (c === quote) {
						++this.i;
						return {done : false, value : {
							op,
							kind,
							value : val,
							hasWildcard,
							beginIndex,
							endIndex : this.i,}};
					};

					if (c == escChar && this.i + 1 < len) {
						c = xpr[this.i + 1];
						this.i += 1;
						/* within quotes, any character can be escaped */
						dbg && assert(codePointLengthAt(escChar) === 1);
					};

					if (c === wildcardChar) {
						hasWildcard = true;};

					val += c;
					this.i += codePointLengthAt(xpr, this.i);
				};

				/* quote unterminated */
				this.i = iVal;
			};
		};

		/* parse unquoted value: */
		let val = ``;
		let hasWildcard = false;
		while (this.i < len
			&& !codePointIsWhitespace(xpr.codePointAt(this.i)))
		{
			let c = xpr[this.i];
			if (c === escChar && kind !== `` && this.i + 1 < len
				&& codePointIsWhitespace(xpr.codePointAt(this.i + 1)))
			{
				val += xpr[this.i + 1];
				this.i += 2;
				/* outside quotes, only whitespace can be escaped */
				dbg && assert(codePointLengthAt(escChar) === 1);
			} else {
				if (c === wildcardChar) {
					hasWildcard = true;};

				val += c;
				this.i += codePointLengthAt(xpr, this.i);
			};
		};

		if (op !== `` && this.i === iVal && kind === ``) {
			/* operator with empty value and no qualifier */
			val = xpr.slice(beginIndex, this.i);
			op = ``;
		};

		dbg && assert(this.i > beginIndex);

		return {done : false, value : {
			op,
			kind,
			value : val,
			hasWildcard,
			beginIndex,
			endIndex : this.i,}};
	},

	[Symbol.iterator]() {return this;},
};

const parseTermsResultProto = {
	[Symbol.iterator]() {
		return {
			__proto__ : parseTermsIterProto,
			xpr : this.xpr,
			i : 0,};
	},
};

export function parseTerms(xpr) {
	/* returns a sequence of
	{
		op : termOps,
		kind : ``|<word>, (metatag prefix)
		value : <string>,
		hasWildcard : <bool>,
		beginIndex : <uint>,
		endIndex : <uint>,
	}

	terms are returned in the order they appear in xpr

	some behaviours deviate from danbooru's own algorithm:
	• metatag prefixes are considered to be any words matching /[a-z0-9_]+/i,
	whereas danbooru will only separate the prefix when it encounters
	recognised metatag names
	• wildcards are identified in all metatags, though only some metatags
	actually support wildcards (e.g. source:, commentary:)
	• whitespace is not automatically replaced with u+0020

	normalisation of values is not performed here
	however metatag qualifiers are normalised (i.e. lowercased)

	note that normalisation of metatag values may require lowercasing of
	non-latin characters (e.g. À → à) */

	dbg && assert.str(xpr);
	return {
		__proto__ : parseTermsResultProto,
		xpr,};
};

export function isValidTag(s) {
	/* only applicable to plain tags (not metatags) */
	dbg && assert.str(s);

	let n = s.length;
	if (n === 0 || isTermOp(s[0])) {
		return false; /* can't be empty, can't begin with an operator */};

	let hasNonIdentChar = false;
	for (let i = 0; i < n; ++i) {
		let cpt = s.charCodeAt(i); /* no surrogate pairs */
		if (!common.codePointIsGraphicalAscii(cpt)
			|| cpt === wildcardChar.codePointAt(0))
		{
			return false;};

		if (cpt === kindSepChar.codePointAt(0)) {
			if (!hasNonIdentChar && i > 0) {
				/* can't have a value beginning with a metatag prefix */
				return false;};
			hasNonIdentChar = true;
		} else if (!hasNonIdentChar) {
			hasNonIdentChar = !codePointIsIdentChar(cpt);};
	};

	return true;
};

export function tryFormatTerm({kind, value, op = termOps.include}) {
	/* attempts to format the specified term as a string;
	returns undefined upon failure */

	dbg && assert.str(op);
	dbg && assert.str(kind);
	dbg && assert.str(value);

	if (kind !== `` && op === termOps.union) {
		return undefined; /* can't use ~ with metatags */};

	if (value === `` && kind === ``) {
		return undefined; /* can't have empty value and no qualifier */};

	if (op === termOps.include && kind === `` && isTermOp(value[0])) {
		return undefined; /* plain term can't begin with operator */};

	if (!isTermOp(op)) {
		return undefined; /* unknown operator */};

	for (let i = 0, n = kind.length; i < n;) {
		let c = kind.codePointAt(i);

		if (!codePointIsIdentChar(c)) {
			return undefined; /* forbidden characters in qualifier name */};

		i += codePointLength(c);
	};

	let hasSpace = false;
	let hasNonIdentChar = false;
	let hasQuote = false;
	for (let i = 0, n = value.length; i < n;) {
		let c = value[i];
		let cpt = c.codePointAt(0);

		hasQuote = hasQuote || c === aposChar || c === dquoteChar;
		hasSpace = hasSpace || codePointIsWhitespace(cpt);

		if (kind !== ``) {
			if (c === defaultQuoteChar) {
				/* escape quotes: */
				value = value.slice(0, i)+escChar+value.slice(i);
				++i;
				++n;
			};
		} else if (c === kindSepChar) {
			if (!hasNonIdentChar && i > 0) {
				/* an un-qualified term can't have a value beginning with
				a metatag prefix (e.g. {kind : ``, value : `rating:s`}) */
				return undefined;
			};
			hasNonIdentChar = true;
		} else {
			hasNonIdentChar = hasNonIdentChar || !codePointIsIdentChar(cpt);
		};

		i += codePointLength(cpt);
	};

	if (hasSpace && kind === ``) {
		return undefined; /* can't contain spaces with no qualifier */};

	/* surround with quotes if necessary: */
	let q = kind !== `` && (hasSpace || hasQuote) ? defaultQuoteChar : ``;

	return op+kind+(kind !== `` ? kindSepChar : ``)+q+value+q;
};

const operateXprIterProto = {
	next() {
		let term = null;
		if (this.termsIter !== null) {
			let {done, value} = this.termsIter.next();
			if (done) {
				this.termsIter = null;
				this.found = null;
			} else {
				term = value;};
		};

		if (term === null) {
			/* termsIter exhausted */

			/* this.mOps contains any terms that
			have not been encountered yet */

			while (true) {
				let kv = common.first(this.mOps);
				if (kv !== undefined) {
					let [kind, mSub] = kv;
					kv = common.first(mSub);
					if (kv !== undefined) {
						let [value, op] = kv;
						term = {kind, value, op};
						mSub.delete(value);
						break;
					} else {
						/* mSub is empty */
						this.mOps.delete(kind);
					};
				} else {
					/* mOps is empty */
					return {done : true, value : undefined};
				};
			};

			dbg && assert.obj(term);

			/* append the term to the end: */

			let withSpaceBefore =
				this.offset > 0 && !codePointIsWhitespace(
					this.xpr.codePointAt(this.offset - 1));
			/* note: if the previous term gets deleted, the result should still
			be valid, since that term should itself begin after whitespace
			or the start of the expression */

			let beginIndex = this.offset + (withSpaceBefore ? 1 : 0);
			let endIndex = beginIndex;
			/* include trailing whitespace: */
			while (endIndex < this.xpr.length
				&& codePointIsWhitespace(this.xpr.codePointAt(endIndex)))
			{
				++endIndex;
			};

			return {
				done : false,
				value : {
					changed : true,
					beginIndex,
					endIndex,
					term : {
						...term,
						beginIndex,
						endIndex : beginIndex,},},};
		};

		dbg && assert.obj(term);
		let {beginIndex, endIndex} = term;

		if (this.offset === 0) {
			/* first segment includes any leading space: */
			beginIndex = 0;};

		/* segment includes any space immediately following the term: */
		while (endIndex < this.xpr.length
			&& codePointIsWhitespace(this.xpr.codePointAt(endIndex)))
		{
			++endIndex;
		};

		this.offset = endIndex;

		let seg = {
			beginIndex,
			endIndex,
			changed : false,
			term,};

		let mSub = this.mOps.get(term.kind);
		if (mSub !== undefined) {
			let tNorm = this.normaliseTerm(term);
			let vNorm = tNorm.value;
			dbg && assert(tNorm.kind === term.kind);

			let fSet = this.found.get(term.kind);
			dbg && assert.obj(fSet);

			if (fSet.has(vNorm)) {
				/* repeated term - delete */
				seg.changed = true;
				seg.term = null;
			} else {
				let op = mSub.get(vNorm);
				if (op !== undefined) {
					/* matching term - modify */
					fSet.add(vNorm);
					mSub.delete(vNorm);

					seg.changed = (term.value !== vNorm || tNorm.op !== op);
					tNorm.op = op;
					seg.term = tNorm;
				};
			};
		};

		return {done : false, value : seg};
	},

	[Symbol.iterator]() {return this;},
};

const operateXprResultProto = {
	[Symbol.iterator]() {
		/* these maps will be mutated throughout the process: */
		let mOps = new Map(/* kind → value → op */);
		let found = new Map(/* kind → Set(values...) */);

		for (let term of this.applicandTerms) {
	
			dbg && assert(
				this.normaliseTerm(term).value === term.value,
				`term values must be already normalised`);

			assignTermMap(mOps, term);

			if (!found.has(term.kind)) {
				found.set(term.kind, new Set);};
		};

		return {
			__proto__ : operateXprIterProto,
			xpr : this.xpr,
			termsIter : parseTerms(this.xpr)[Symbol.iterator](),
			mOps,
			normaliseTerm : this.normaliseTerm,
			offset : 0,
			found,
			done : false,};
	},
};

export function operateXpr(
	xpr, /* string */
	applicandTerms, /* sequence of {kind, value, op}...
		`value` must be normalised already */
	normaliseTerm = t => t)
{
	/* merges `applicandTerms` into `xpr`;
	any existing terms in `xpr` which conflict with `applicandTerms` are deleted

	ops in `applicandTerms` aren't validated, so non-standard ops
	such as 'absent' may be used if necessary; however, `undefined` will be
	treated as `include`

	returns a sequence of segment details, each covering one term from the
	input expression, potentially with changes:
	{
		beginIndex : <uint>,
		endIndex : <uint>,
		changed : <bool>,
		term : <term>|null,
	}

	segments are returned in the order they appear in `xpr`

	terms in the output are not necessarily normalised;
	`normaliseTerm` is used for comparison purposes

	if `term` is null, it has been deleted

	`endIndex` is extended to cover any space immediately following the term;
	`beginIndex` for the first segment includes any leading whitespace

	if `changed` is true, the term contents may be longer or shorter than the
	ranges specified by beginIndex/endIndex and term.beginIndex/term.endIndex

	beginIndex/endIndex may also be outside the bounds of the expression string
	if it needs to be extended to include the new term */

	dbg && assert.str(xpr);
	dbg && assert.sequ(applicandTerms);
	dbg && assert.fn(normaliseTerm);

	return {
		__proto__ : operateXprResultProto,
		xpr,
		applicandTerms,
		normaliseTerm,};
};

export function getFromTermMap(m /* kind → value → op */, {kind, value}) {
	return common.getFromSubMap(m, kind, value);
};

export function deleteFromTermMap(m /* kind → value → op */, {kind, value}) {
	dbg && assert(m instanceof Map);
	let sub = m.get(kind);
	if (sub !== undefined) {
		dbg && assert(sub instanceof Map);
		sub.delete(value);
		if (sub.size === 0) {
			m.delete(kind);};};
};

export function assignTermMap(m /* kind → value → op */, t) {
	common.ensureSubMap(m, t.kind).set(t.value, termOp(t));
};

export function termMapFrom(terms) {
	let m = new Map();
	for (let t of terms) {
		assignTermMap(m, t);};
	return m;
};

export function iterateTermMap(m /* kind → value → op */) {
	return common.chainFrom(Array.from(
		common.map(m, ([kind, sub]) =>
			common.map(sub, ([value, op]) =>
  				({kind, value, op})))));
};

/* -------------------------------------------------------------------------- */

/*





















































*/

/* -------------------------------------------------------------------------- */