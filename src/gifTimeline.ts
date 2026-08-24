export interface GifFrameLike {
    delay: number;
}

export interface SampledGifFrame<T extends GifFrameLike> {
    frame: T;
    delay: number;
}

const DEFAULT_FRAME_DELAY = 100;
const MIN_FRAME_DELAY = 20;

function normalizeDelay(delay: number): number {
    if (!Number.isFinite(delay) || delay <= 0) return DEFAULT_FRAME_DELAY;
    return Math.max(MIN_FRAME_DELAY, Math.round(delay / 10) * 10);
}

/**
 * Limits expensive full-card renders while preserving the GIF's total duration.
 * Each retained frame carries the combined delay of the frames skipped after it.
 */
export function sampleGifFrames<T extends GifFrameLike>(
    frames: T[],
    maxFrames: number
): Array<SampledGifFrame<T>> {
    if (frames.length === 0 || maxFrames <= 0) return [];

    const sampleCount = Math.min(frames.length, Math.floor(maxFrames));
    const samples: Array<SampledGifFrame<T>> = [];

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const start = Math.floor(sampleIndex * frames.length / sampleCount);
        const end = Math.floor((sampleIndex + 1) * frames.length / sampleCount);
        let delay = 0;

        for (let frameIndex = start; frameIndex < end; frameIndex++) {
            delay += normalizeDelay(frames[frameIndex].delay);
        }

        samples.push({ frame: frames[start], delay });
    }

    return samples;
}
