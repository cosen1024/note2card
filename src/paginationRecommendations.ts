export type PaginationMode = 'continuous' | 'headings';

export interface CardHeightRecommendationOptions {
    fontFamily?: string;
    fontSize?: number;
    hasAvatar?: boolean;
}

const BASE_HEIGHT_BY_FAMILY = {
    song: 500,
    default: 520
} as const;

const FONT_SIZE_BASELINE = 16;
const FONT_SIZE_STEP = 20;
const AVATAR_HEIGHT_COST = 40;
const MIN_CARD_HEIGHT = 300;

function getFontFamilyBucket(fontFamily?: string): keyof typeof BASE_HEIGHT_BY_FAMILY {
    const normalized = (fontFamily || '').toLowerCase();

    if (normalized.includes('simsun') || normalized.includes('宋体')) {
        return 'song';
    }

    return 'default';
}

export function hasAvatar(userAvatar?: string): boolean {
    return Boolean(userAvatar && userAvatar.trim());
}

export function getRecommendedCardHeight(options: CardHeightRecommendationOptions): number {
    const fontSize = Number.isFinite(options.fontSize) ? Number(options.fontSize) : FONT_SIZE_BASELINE;
    const baseHeight = BASE_HEIGHT_BY_FAMILY[getFontFamilyBucket(options.fontFamily)];
    const sizeAdjustment = (FONT_SIZE_BASELINE - fontSize) * FONT_SIZE_STEP;
    const avatarAdjustment = options.hasAvatar ? -AVATAR_HEIGHT_COST : 0;

    return Math.max(
        MIN_CARD_HEIGHT,
        Math.round(baseHeight + sizeAdjustment + avatarAdjustment)
    );
}
