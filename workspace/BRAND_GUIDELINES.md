# BRAND.md — ZINN Architecture + Interiors Brand Standards

Source of truth for all AI-generated content, emails, proposals, documents, and marketing materials.

---

## Identity

**Full name:** ZINN Architecture + Interiors  
**Tagline:** elevating the everyday  
**Website:** zinn.ai  
**Contact:** info@zinn.ai · 904.352.1203  
**Address:** 1022 park street #407, jacksonville, fl 32204

## Color Palette

Strictly monochromatic. No brand accent color.

| Name | Hex | Usage |
|---|---|---|
| True black | `#000000` | Rules, borders, buttons, strong emphasis |
| Dark charcoal | `#1A1A1A` / `#222222` | Dark banner backgrounds |
| Body text | `#4e5757` | Paragraph text, secondary content |
| Muted label | `#81A2B2` | Metadata, captions, labels, tertiary text |
| Mid gray | `#666666` | Sub-labels, supporting text |
| Light gray | `#999999` | Tertiary descriptors |
| Border | `#CCCCCC` – `#E0E8EC` | Card borders, dividers, rules |
| Page bg | `#F0F0F0` – `#F5F5F5` | Email body background, footer tint |
| White | `#FFFFFF` | Content area background |

**Rule:** No blues, reds, greens, or any chromatic accent anywhere. If something needs emphasis, use weight and size — not color.

### Type Hierarchy

| Level | Size | Weight | Case | Tracking |
|---|---|---|---|---|
| Section labels (proposal/email) | 18px | Light (300) | lowercase | 1px |
| Section headers | 13–15pt | Bold (700) | ALL CAPS | Slightly wide |
| Firm/project names | 13–14pt | Bold (700) | Title Case | Normal |
| Role labels | 9–10pt | Semibold (600) | ALL CAPS | Wide (0.1em) |
| Body text | 13px | Regular (400) | Sentence case | 0.5px |
| Metadata / captions | 11px | Regular (400) | lowercase | 1px |
| Footer | 11px | Regular (400) | lowercase | Normal |

## Typography
- **Primary font:** Avenir Next (macOS system), fallback: Spartan, Helvetica Neue, Arial, sans-serif
- **Headings:** Avenir Next Bold or Semibold, letter-spacing 0.5-3px
- **Body:** Avenir Next Regular, 11-13px, line-height 1.6-1.8
- **Small/labels:** 8-9px, uppercase where appropriate, color #555 or #888
- **CSS stack:** `'Avenir Next', Avenir, Spartan, 'Helvetica Neue', Helvetica, Arial, sans-serif`
- **Web font alternative:** Inter (if system fonts unavailable in external context)  
- **Google Fonts alternative:** Spartan

## Layout & Spacing

**Base unit:** 8px (spacing follows multiples: 8, 16, 24, 32, 40, 48)

| Element | Value |
|---|---|
| Page/email margins | 40–60px |
| Section padding | 40px vertical, 48px horizontal |
| Card internal padding | 16–20px |
| Grid gutters | 16–24px |
| Paragraph spacing | 8–12px |
| Body line-height | 1.7–1.8 |
| Heading line-height | 1.3 |

**Grid:** 3-column or 12-column. Cards in 2×2 grids. Max content width: 680px (email/proposal).

## Cards & Containers

- **Border:** 1px solid `#E0E8EC` (light) or `#CCCCCC`
- **Background:** white `#FFFFFF`
- **Border radius:** none or ≤2px (nearly square corners)
- **Shadow:** none — flat design only
- No gradients, no textures

## Buttons & CTAs

- **Background:** `#000000` (black)
- **Text:** `#FFFFFF` white
- **Font:** Avenir Next, 11px, weight 500, uppercase, 2px letter-spacing
- **Padding:** 14px top/bottom, 28px left/right
- **Border radius:** 0–2px
- **Hover:** no JavaScript effects needed in static contexts

## Email Standards

Template structure (top to bottom):
1. header area with ZINN logo (CID inline image)
2. Black 1px `<hr>` separator
3. White content area (padding: 40px 48px)
4. Black `<hr>` or `#E0E8EC` separator before signature
5. Signature: "Thank you, / Rob." then rule, Rob Zinn AIA NCARB, zinn.ai link, phone
6. Light gray footer: address · phone · email (all in `#81A2B2`)

**Font in emails:** `'Avenir Next', Avenir, Spartan, 'Helvetica Neue', Helvetica, Arial, sans-serif`  
**No dark header** — white only with inline logo  
**All links:** `#242C39` — black, no underline  
**Signature links:** same — black, no underline  
**Logo file:** `~/.openclaw/workspace/_zinn_logo.png` (CID: `zinn-logo`)

---

## Design Principles

- **Minimalist, professional, authoritative** — the restraint IS the statement
- **Zero ornamentation** — no icons, no illustrations, no decorative elements
- **Information density** without clutter — hierarchy through typography alone
- **Architectural precision** — spacing and alignment are never approximate
- **Swiss/International Style** — clean modernism, no decoration
- **Confidence through restraint** — less is always more

### What NOT to do
- No color accents — ever
- No rounded containers (beyond 2px)
- No drop shadows
- No gradients
- No custom icons
- No emoji in professional materials
- No cheerful marketing language ("excited!", "amazing!")

## Voice & Tone

- Direct, professional, no fluff
- First person singular ("I have developed…" not "We have developed…") in proposals
- Formal but not stiff — architectural confidence
- No exclamation points in professional correspondence
- No filler phrases ("I hope this email finds you well", "Please don't hesitate")
- Lowercase brand name and section headers are intentional — not a typo


## Layout Principles
- **Clean, minimal, generous whitespace**
- **No emojis. Ever.**
- **No color accents** -- black, white, grey palette only
- **Table-based layout for email** (Gmail strips `<style>` blocks; all CSS inline)
- **Max content width:** 620-680px for emails, full page for documents
- **Margins:** 24-36px horizontal padding
- **Header:** ZINN logo left, contact info right, separated by 2px solid #1a1a1a bottom border
- **Footer:** Light grey background (#f7f7f7), 1px top border #e0e0e0, small centered text
