export function shouldRenderSplitHeading(pageIndex: number): boolean {
    return pageIndex === 0;
}

export function shouldSkipRenderedElement(input: {
    tagName?: string;
    classNames?: string[];
}): boolean {
    const classNames = new Set(input.classNames || []);
    const skipClassNames = [
        'metadata-container',
        'metadata-properties',
        'metadata-property',
        'frontmatter',
        'frontmatter-container'
    ];

    return skipClassNames.some(className => classNames.has(className));
}

function splitLargeSegment(segment: string, maxChars: number): string[] {
    if (segment.length <= maxChars) {
        return [segment];
    }

    const parts: string[] = [];
    for (let i = 0; i < segment.length; i += maxChars) {
        parts.push(segment.slice(i, i + maxChars));
    }
    return parts;
}

export function splitTextForPagination(text: string, maxChars: number): string[] {
    const normalized = text || '';
    if (!normalized) {
        return [];
    }

    const safeMaxChars = Math.max(1, maxChars);
    const sentenceLikeSegments = normalized.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g) || [normalized];
    const expandedSegments = sentenceLikeSegments.flatMap(segment =>
        splitLargeSegment(segment, safeMaxChars)
    );

    const chunks: string[] = [];
    let currentChunk = '';

    expandedSegments.forEach(segment => {
        if (!currentChunk) {
            currentChunk = segment;
            return;
        }

        if ((currentChunk + segment).length <= safeMaxChars) {
            currentChunk += segment;
            return;
        }

        chunks.push(currentChunk);
        currentChunk = segment;
    });

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}
