import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MathText} from '../src/ui.tsx';

test('AI bracket-delimited display formulas render as math instead of broken Markdown headings',()=>{
 const text=String.raw`行内 \(x^2\)，以及已有 $y^2$。

\[
\lim_{x\to 0}\frac{e^{2x}-e^{-2x}}{\sin 3x}=\frac43
\]

\[\begin{pmatrix}1&2\\3&4\end{pmatrix}\]

$$
\int_0^1 x\,dx=\frac12
$$`;
 const html=renderToStaticMarkup(createElement(MathText,{text}));
 assert.equal((html.match(/class="katex-display"/g)||[]).length,3);
 assert.ok((html.match(/class="katex"/g)||[]).length>=5);
 assert.doesNotMatch(html,/katex-error|<h[1-6]|\\\[|\\\]/);
});
