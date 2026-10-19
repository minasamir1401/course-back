"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.protectRenderedMath = protectRenderedMath;
/** Keep existing rendered trees out of delimiter processing, including data-latex. */
function protectRenderedMath(html) {
    const blocks = [];
    const start = /<(span|math)\b[^>]*>/gi;
    let output = '', end = 0, match;
    while ((match = start.exec(html))) {
        if (match[1].toLowerCase() !== 'math' && !/\bdata-latex\s*=|\bclass=["'][^"']*\b(?:math-tex|katex)(?:[\s"'])/i.test(match[0]))
            continue;
        const tags = new RegExp(`<\\/?${match[1]}\\b[^>]*>`, 'gi');
        tags.lastIndex = start.lastIndex;
        let depth = 1, close;
        while ((close = tags.exec(html))) {
            depth += /^<\//.test(close[0]) ? -1 : /\/>$/.test(close[0]) ? 0 : 1;
            if (!depth)
                break;
        }
        if (depth)
            continue;
        output += html.slice(end, match.index) + `\x00RENDERED${blocks.length}\x00`;
        blocks.push(html.slice(match.index, tags.lastIndex));
        end = tags.lastIndex;
        start.lastIndex = end;
    }
    return { html: output + html.slice(end), blocks };
}
