---
name: media-machine
description: End-to-end content pipeline for ZINN Architecture — from 3D model wireframe to photorealistic AI rendering to approved social media post. Use when asked to create renderings, generate social content, draft post copy, prepare marketing visuals, or run the media/content pipeline. Also triggers on "media machine," "rendering," "social media post," "Instagram," "content pipeline," or requests involving Leonardo.ai, SketchUp screenshots, or architectural visualization for marketing.
---

# Media Machine

Turns work-in-progress 3D models into photorealistic renderings and approved social media content.

## Pipeline Overview

1. **Receive seed image** — wireframe screenshot from SketchUp
2. **Describe the scene** — factual, quantitative description of what is physically shown
3. **Build the prompt** — scene description + camera specs + lighting + realism details
4. **Generate via Leonardo.ai API** — image-to-image with seed as guidance, 4 variations
5. **Review and upscale** — pick best result, upscale
6. **Draft post copy** — write caption in the ZINN voice
7. **Approval** — present rendering + copy for Rob's approval
8. **Distribute** — blast to website news feed, socials, collect for monthly email

## Voice and Ethos

ZINN is the "friendly neighborhood architect who also happens to be the most prepared person in the room."

The content pillar: **Make the invisible visible.**

Every post should do one of three things:
1. **Show work in progress** — not just the pretty finish, but the thinking behind it. A wireframe next to the rendering. "Here is why this wall is where it is."
2. **Explain a step in the process** — permitting, structural coordination, a detail that took three iterations. Make the invisible visible.
3. **Celebrate the delivered result** — with the client's story, not just the image.

### Tone Rules
- Direct, warm, knowledgeable but never condescending
- Explain design and construction in simple language — it is not rocket science when you honor the process
- Engender respect for the profession without gatekeeping it
- Never use emojis
- "If you think it is expensive to hire a professional, wait until you hire an amateur." — Red Adair
- "10 minutes in the office is worth weeks in the field if something is not done properly."
- We do not rush through design and documentation because precision prevents problems

### Caption Format
- 1-3 short paragraphs, max 150 words total
- First line hooks attention (what the viewer is looking at, stated simply)
- Middle explains the design thinking or process insight
- Last line is a call to reflection, not a call to action. No "Contact us today!" ever.
- Hashtags: #ZINNarchitecture #elevatetheveryday + 2-3 project-specific tags

## Rendering Process

See `references/rendering-process.md` for the full step-by-step with camera specs, lighting phrases, and realism detail lists.

Key principle: **The viewer should believe the building is already built.** Photorealism is the standard. Computer-generated-looking renderings are a liability.

## Leonardo.ai API

### Setup
- API key stored in TOOLS.md under "Leonardo.ai API"
- Endpoint: `https://cloud.leonardo.ai/api/rest/v1/`
- Requires API credits (separate from web subscription)

### Workflow
1. Upload seed image: `POST /init-image` to get presigned S3 URL, upload, receive `initImageId`
2. Generate: `POST /generations` with image-to-image guidance using the seed
3. Poll for completion: `GET /generations/{generationId}`
4. Upscale: `POST /variations/upscale` with selected image ID

See `scripts/leonardo-generate.js` for the complete generation script (created after API key is provided).

## Content Streams

### Stream 1: Renderings (active)
The primary pipeline described above. Wireframe to photorealistic rendering to post.

### Stream 2: Field and Studio Snaps (planned)
Quick photos sent from the office or job site — phone camera, no staging required. These show the firm doing the work: a markup session at the desk, a site visit with hard hats, a detail being framed, a material sample on the conference table, a team meeting around a model.

This stream requires:
- A way to receive photos (WhatsApp, iMessage, or direct file drop)
- Howard identifies the best shot(s), crops/adjusts if needed
- Drafts a caption that explains what is happening and why it matters
- Same approval and distribution flow as renderings

The voice for field/studio content is more casual and behind-the-scenes than rendering posts, but still grounded in the ZINN ethos: we honor the process, we pay attention to what most people skip, and the work we do in the office and on the site is what makes the finished product possible.

**Content ideas for this stream:**
- Red-line markup sessions ("10 minutes in the office saves weeks in the field")
- Site visits and progress walks
- Material samples and selection process
- Team collaboration moments
- A detail being built that matches the drawing
- Before/during/after sequences
- Tools of the trade (the SketchUp model, the printed set, the field notebook)

### Stream 3: Project Milestones (planned)
Triggered by Trello phase transitions. When a project moves from CD to Permitting, or Permitting to Bidding, or breaks ground — that is a content moment. Howard drafts a post marking the milestone. "Another one headed to permit review. 11 months from first sketch to this stack of drawings."

---

## Distribution Channels

Upon approval, content goes to:
1. **Website news feed** — project page or blog post
2. **Instagram** — primary visual channel
3. **Facebook** — cross-post from Instagram
4. **LinkedIn** — if project has commercial/institutional relevance
5. **Monthly email** — collected for subscriber newsletter digest

## Referral Integration

After any completed project rendering is posted, check if the client is on the referral list. If yes, share the post with them and thank them — it is a natural touchpoint.

## File Organization

All rendering assets saved to the project Dropbox folder:
```
project_folder/
  _renderings/
    YYYY_MM_DD/
      seed-[view-name].png
      render-[view-name]-01.png (through 04)
      render-[view-name]-upscaled.png
      post-copy.md
```
