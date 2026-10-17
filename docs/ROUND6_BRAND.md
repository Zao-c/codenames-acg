# 双牌结社 / 连想星

Original geometry drawn specifically for this project during Round 6: two linked
cards and a four-point association spark, neutral indigo outlines, small red/blue
accents. No third-party character art, embedded fonts, stock image or wallpaper.
Existing Bangumi cover images remain game metadata, never brand artwork.

Assets in `apps/web/public/brand/`:

| Resource | Dimensions / purpose |
| --- | --- |
| cipai-icon.svg | 64×64 viewBox; adaptive light/dark favicon |
| cipai-lockup.svg | 250×64; horizontal Chinese wordmark, system font |
| cipai-mono.svg | 64×64; monochrome outline |
| cipai-spark.svg | 120×120; small homepage-only geometric decoration |
| cipai-16.png / cipai-32.png | 16×16 / 32×32 fallback icons |
| cipai-app-180.png | 180×180 Apple touch icon |

Navbar uses the same original geometry in BrandMark.tsx with existing theme tokens.
SVGs contain no scripts or external assets. PNGs are rendered from resolved light
SVG colors with the existing sharp dependency. Favicon references include `?v=6`.
Screen-reader label is the existing visible brand text; decorative SVG is hidden
from accessibility APIs. Homepage decoration is static, noninteractive, and hidden
on mobile. There is no decorative illustration in any board or candidate grid.

Capacity remains eight players. This round adds no third-party image license or
new dependency. Resource byte sizes and theme previews are in the acceptance
report and screenshot directory.
