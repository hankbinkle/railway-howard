# SKILL.md — Keynote Parser

Generate keynote tables in `.layout` files from Trello data. Uses Python XML generation (primary) or SketchUp Layout Ruby API (backup).

## Source of Truth

- **Trello board:** https://trello.com/b/DYR1AUMQ/zinn-keynotes (id: `69f927cfac3847401e5ca448`)
- **Lists:** Drawing keys (A002-site_plan, A003-life_safety_plans, etc.)
- **Cards:** Keynote text (name), section (desc as `## section` + value), labels (tags)
- **No codes on Trello cards** — codes are generated at table creation time

### Label Filtering (AND Logic)

Keynotes are only included for a project if **ALL labels on the card** are present in the project's label set. This ensures only relevant keynotes appear (e.g. a card tagged `commercial, life_safety, multi_story, elevator` only appears on projects that have all four labels).

Cards with **no labels** are always included (they apply to all projects).

### Label Taxonomy

| Category | Labels |
|---|---|
| Type | `residential` `commercial` `multifamily` `shell` `warehouse` |
| Work | `renovation` (absent = new build) |
| Scope | `exterior` `multi_story` `garage` `finishes_and_fixtures` `life_safety` `mep_required` `fire_sprinkler` `flood_zone` `elevator` `historic` |

## Code Generation

Codes are generated dynamically in format `XXYY00`:

- **XX** = 2-letter sheet abbreviation
- **YY** = 2-letter section abbreviation
- **00** = 2-digit sequential number within section

### Sheet Types

**10 Keynote Sheets:**

| List name | Abbr |
|---|---|
| A002-site_plan | SP |
| A003-life_safety_plans | LS |
| A100-demolition_plans | DP |
| A200-proposed_plans | PR |
| A210-finish_plans | FP |
| A220-dimension_plans | DM |
| A230-ceiling_plans | CP |
| A240-roof_plans | RF |
| A300-exterior_elevations | EE |
| A500-interior_elevations | IE |

**4 Non-Keynote Sheets** (templates provided for reference, no table generation):

| Sheet |
|---|
| A001-index |
| A400-building_sections |
| A800-details |
| A900-schedules |

### Section Abbreviations

See `SECTION_ABBRS` dict in `generate_keynote_table.py`.

## Primary Method: Python XML Generation (No SketchUp Required)

### Usage

```bash
python3 scripts/generate_keynote_table.py <layout_file> <drawing_key> [--labels label1 label2 ...]
```

Examples:
```bash
# Generate from cache with label filter
python3 scripts/generate_keynote_table.py A002-site_plan.layout A002-site_plan \
  --labels commercial exterior warehouse

# Without filter (all keynotes for this sheet)
python3 scripts/generate_keynote_table.py A002-site_plan.layout A002-site_plan
```

### Arguments

| Arg | Description |
|---|---|
| `layout_file` | Path to .layout file (uses `sheet_template.layout` as starting point) |
| `drawing_key` | Sheet identifier (e.g., A002-site_plan, A003-life_safety_plans) |
| `--labels` | Space-separated label filter. Only keynotes matching ALL labels included. Keynotes with no labels always included. |

### How it works

1. Reads the .layout file (zip of XML files)
2. Fetches keynote data from Trello API or cache
3. Filters by labels (if provided)
4. Groups by section, generates codes
5. Removes old table + pill entities from document.xml and their stale layer refs
6. Builds new table + pill XML matching Layout native format
7. Registers table in ANNO-COMMON layer instance, pills in ANNO layer instance (creates ANNO instance if missing)
8. Repacks the zip preserving metadata

### Table Spec

| Property | Value |
|---|---|
| Position (top-left) | x=26.764, y=0.5 |
| Size | 5.75" wide x 21.0" tall |
| Columns | indent(0.4") \| code(0.85") \| text(4.5") |
| Row heights | Title 0.35", sections 0.30", items evenly distributed in remaining 21" |
| Linework | #EFEFEF (4293914607), 0.6pt |
| Font | Spartan (sections bold) |
| Title | "SITE PLAN KEYNOTES", fs20 (10pt) |
| Section headers | Full-span merge, bold, fs16 (8pt) |
| Codes | Center-center, Spartan, fs14 (7pt) |
| Body text | Center-left, Spartan, fs14 (7pt) |
| Pills | Rounded rect, AndaleMono fs12 (6pt), 0.35" left of table |

**⚠️ Linework is set via the Layout Ruby API** (`row.bottom_edge_style = Style.new`). In the Python XML approach, edge paths use `shouldStroke="0"` — Layout applies its default (or API-set) styling to edges. The EFEFEF/0.6pt appearance is only achieved when tables are created via the Ruby API. When generating XML directly, edge lines appear but with Layout's default stroke styling.

### Coordinate System

Layout uses screen coordinates: y=0 at top of page, y increases downward. Page is 34" x 22".

### Key Architectural Decisions

**Layer registration:** Entities must be registered in a layer instance to be visible. The table goes on ANNO-COMMON, pills go on ANNO. Each gets `<e:entity l:ref="idNNN" />` entries in the respective layer's `<ld:entityList>`.

**IMPORTANT: Only the table ID itself is registered on ANNO-COMMON.** The edge paths and cells are children of the `<e:table>` element — they do NOT get their own layer refs. Registering only the table ID is sufficient for all its children to be visible.

### Edge Line Visibility (Critical Insight — Debugged 2026-05-15)

Edge paths inside `<e:table>` must follow this exact pattern to render:

**CORRECT (visible lines):**
```xml
<e:row_edge_0>
  <e:path id="id8106" wantInternalPoints="0" rotationAngle="0" requiresStrokeOrFill="0">
    <e:graphicEntity shouldFill="0" strokeWidth="0.600025">
      <e:entity />
    </e:graphicEntity>
    ...
  </e:path>
</e:row_edge_0>
```

**WRONG (invisible lines / Layout crash):**
- ❌ `shouldStroke="0"` — **explicitly disables rendering.** The `shouldStroke` attribute must be OMITTED so Layout defaults to `true`.
- ❌ `strokeColor` attribute — **causes Layout to crash** when set on edge paths inside `<e:table>`.
- ❌ `requiresStrokeOrFill="1"` — use `"0"` instead.
- ❌ Edge paths as separate entities outside `<e:table>` — **causes Layout to crash** with `requiresStrokeOrFill="1"`.

**Why the contradiction with the Layout Ruby API?**
The Ruby API sets edge styles via `row.bottom_edge_style = Style.new(...)` which stores the edge style as a **property of the table object**, overriding the path's `shouldStroke="0"`. Without the Ruby API (pure XML generation), the paths must declare `strokeWidth` directly and NOT set `shouldStroke="0"`.

**Rule of thumb:**
- Tables created via **Ruby API** → edge paths use `shouldStroke="0"` (table object provides style)
- Tables created via **XML generation** → edge paths omit `shouldStroke` and set `strokeWidth` directly
- **Never** put `strokeColor` on edge `<e:path>` elements — Layout crashes

- **Table** → ANNO-COMMON (shared=1 layer, always has an instance in templates)
- **Pills** → ANNO (shared=0 layer, uses **page-level** entity lists)
- Pills are individual entities (rect + rtfText), NOT wrapped in groups — Layout does not render hand-written XML groups
- **Multi-page templates** (e.g. A300 with NORTH SOUTH + EAST WEST): script automatically finds ALL page XMLs with an ANNO layer instance and injects pills into each one
- Each pill group (rect + text) can be selected as a pair and Grouped manually in Layout

**Stale reference cleanup:** When modifying templates with pre-existing tables, all old table entity IDs must be removed from ALL layer instance entity refs. Failure causes full document corruption (objects visible but non-interactive).

**RTF format:** Must use `&#x0A;` (XML character reference) for newlines in RTF strings, matching Layout native output.

## Backup Method: SketchUp Layout Ruby API

Requires SketchUp open with the .layout file loaded. Uses Layout Ruby API from SketchUp Ruby Console.

```ruby
load "/Users/robzinn/.openclaw/skills/keynote_parser/scripts/build_a002_keynotes.rb"
build_a002_keynotes("/path/to/A002-site_plan.layout")
```

### Layout API Classes Used

| Class | Purpose |
|---|---|
| `Layout::Document` | Open/save `.layout` files |
| `Layout::Table` | Create keynote table at fixed position |
| `Layout::TableRow` | Set row height, bottom edge style |
| `Layout::FormattedText` | Cell text with font/size/anchor |
| `Layout::Style` | Font family, size, bold; stroke color/width |
| `Layout::Rectangle` | Pill shape (TYPE_ROUNDED for rounded rect) |

### FormattedText Constructor

```ruby
Layout::FormattedText.new(text, Geom::Point2d.new(0,0), ANCHOR_TYPE_*)
```

### Bounds2d Constructor

```ruby
Geom::Bounds2d.new(Geom::Point2d.new(x1,y1), Geom::Point2d.new(x2,y2))
```

### Table Row Edge Styles

```ruby
es = row.bottom_edge_style
es.stroke_color = COLOR; es.stroke_width = WIDTH; es.stroked = true
begin; row.bottom_edge_style = es; rescue; end
```

## Files

| File | Purpose | Status |
|---|---|---|
| `scripts/generate_keynote_table.py` | Primary: XML generation (no SketchUp) | Working |
| `scripts/build_a002_keynotes.rb` | Backup: Ruby API via SketchUp | Working |
| `scripts/generate_keynote_table.rb` | Legacy: table from Trello (no pills) | Needs update |
| `references/sheet_template.layout` | Master sheet template (model viewport + header) | Required |
| `references/pill_template.layout` | Pill appearance reference | Reference only |
| `references/keynote-cache.json` | Cached Trello data for offline use | Active |
| `CURRENT_ISSUES.md` | Bug tracking | Active |

## Layout Table XML Format (Reverse-Engineered)

This is the correct XML structure for Layout tables, reverse-engineered from real Layout-created files (hasley_renovation project). **Follow this exactly when generating table XML — deviations cause Layout to crash or render nothing.**

### Key Structural Rules

1. **`<e:table>` structure:** The table element contains:
   - `<e:rectangleBase>` — position and size of the table bounding box
   - `<e:cell_N>` elements — one per grid cell (see indexing below)
   - `<e:row_edge_N>` elements — horizontal grid lines (bottom edge of each row)
   - `<e:column_edge_N>` elements — vertical grid lines
   - **All edges are INSIDE the `<e:table>`, not separate entities.**

2. **Cell indexing is grid-based:** `cell_index = row * 3 + col_index`
   - Merged rows (title, section headers): only `cell_{row*3}` exists
   - Data rows: `cell_{row*3}`, `cell_{row*3+1}`, `cell_{row*3+2}`
   - Example: Row 0=merged → `cell_0`, Row 1=merged → `cell_3`, Row 2=data → `cell_6,7,8`
   - **Do NOT use sequential numbering.** Must be grid-based.

3. **`columnSpan_N="3"` attributes** on the `<e:table>` tag mark merged cells:
   - `<e:table ... columnSpan_0="3" columnSpan_3="3" ...>`
   - The index matches the cell index (grid row×3)

4. **Edge paths have `shouldStroke="0"`** — no inline stroke properties:
   - `requiresStrokeOrFill="0"` (NOT "1")
   - `wantInternalPoints="0"` (required attribute)
   - `<e:graphicEntity shouldFill="0" shouldStroke="0">` — no strokeColor, no strokeWidth
   - **Layout manages edge styling internally** based on table's edge style properties (set via Ruby API).
   - Putting `strokeColor`/`strokeWidth` on edge paths **causes Layout to crash**.

5. **Row edge points** use 4-point format (one segment per column):
   - Elements: `0,1,1,1` (move, line, line, line)
   - Points: `x0,y x1,y x2,y x3,y` (across all 3 columns)

6. **Column edge points** use simple 2-point lines through breaks:
   - The reference file has complex `elements` arrays with `0,1` patterns for breaks at row gaps
   - Simplified: `0,1` works for full-height lines

### Layer Registration

- **Only the table ID** is registered in the ANNO-COMMON layer instance entity list
- Edge paths and cells are children of `<e:table>` — they are NOT individually registered
- **Do NOT register edge lines as separate entities** on any layer

### Common Mistakes (That Crash Layout)

| Mistake | Result |
|---------|--------|
| `requiresStrokeOrFill="1"` on edge paths | Layout crashes on open |
| `strokeColor` or `strokeWidth` on edge graphicEntity | Layout crashes on open |
| Entity list is self-closing `<ld:entityList />` but refs aren't added | Table invisible (no layer binding) |
| Cell indices sequential instead of grid-based (0,1,2,3 vs 0,3,6,7,8) | Layout crashes on open |
| Edge lines as separate paths outside table on ANNO-COMMON | Might render but unexpected behavior |
| Missing `wantInternalPoints="0"` on path elements | Unknown — match reference |

### Reference File

A real Layout file with a working table is at:
`~/ZINN Dropbox/projects/hasley_renovation/A002-site_plans.layout`

To inspect the table XML:
```bash
unzip -p hasley_renovation/A002-site_plans.layout document.xml | grep -A 500 '<e:table'
```

## Troubleshooting

### Table/Pills not visible in Layout
- **Layer registration is the most common cause.** Entities in document XML are not visible on the page unless registered in a `<ld:layerInstance>` entity list.
  - Table should be in ANNO-COMMON instance: `<e:entity l:ref="id8001" />`
  - Pills should be in ANNO instance: `<e:entity l:ref="id80XX" />` for each rect + text
  - The ANNO-COMMON layer definition ID varies per template. Script detects it dynamically.
  - ANNO layer is `shared=0` and may not have a layer instance in the template — script creates one.
- **Self-closing entityList:** Template may have `<ld:entityList />` (empty). Script must expand this to `<ld:entityList>...refs...</ld:entityList>` or refs are ignored.
- Verify no stale layer refs to removed entities
- Verify RTF uses `&#x0A;` not literal `\n`
- **Pills must NOT be wrapped in `<e:group>`** — Layout does not render hand-written XML groups. Pills should be individual `<e:rectangle>` + `<e:rtfText>` entities.

### Grid lines not showing
- Edge paths have `shouldStroke="0"` → **remove it.** `shouldStroke` must be absent (Layout defaults to `true`).
- Edge paths have `shouldFill="0"` + `strokeWidth="0.6"` → correct pattern.
- Missing `strokeWidth` → add it. Without `strokeWidth` AND without Ruby API edge style, Layout has no width to render.
- See "Edge Line Visibility" inset above for the full rules.

### File corrupt / non-interactive
- Stale entity refs in layer instances pointing to removed table entities
- Run the script again — it now cleans stale refs automatically

### Only template elements, no table
- Entity list might have been wiped (preserve existing groups)
- Layer instance refs might be missing
- Table might be outside visible page area

### Layout crashes on open
- Check edge paths: `requiresStrokeOrFill` must be `"0"`, no inline `strokeColor`/`strokeWidth`
- Check cell indices are grid-based, not sequential
- Check ZIP metadata preserved (use the script's repacking, not manual zip)

## Layer Registration (Critical Detail)

Layout uses a three-part system to make document-level entities visible:

1. **Layer Definition:** `<ld:layerDefinition id="id3366" name="ANNO-COMMON">` — defines layers
2. **Layer Instance:** `<ld:layerInstance id="id3473"><ld:layerDefinition l:ref="id3366" />` — instantiates a layer
3. **Entity List:** Within the layer instance, `<e:entity l:ref="id8001" />` — lists which entities appear on that layer

Entities must be registered in ALL three to be visible. The script handles this automatically now:
- Finds the ANNO-COMMON layer definition ID dynamically (regex targets `id="id(\d+)"` before `name="ANNO-COMMON"`)
- Removes stale entity refs from all layer instances
- Adds new table + pill refs only to the ANNO-COMMON instance

**Common mistake:** Hardcoding the layer definition ID. It varies per template (`id2775` is not universal).

## Coordinate System Notes

Layout uses screen coordinates: y=0 at top of page. All y values increase downward.
Page is 34" x 22". The table top-left corner is at (26.764, 0.5).
