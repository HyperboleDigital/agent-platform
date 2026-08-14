import { toFile } from 'openai'
import { GoogleGenAI } from '@google/genai'
import { openai } from './complete'
import type { VisionImage, VisionMediaType } from './complete'
import { geminiImageCostMicros, openaiImageCostMicros } from './pricing'

// Real AI-generated PNG mockups for prospecting — a second concept format
// alongside the HTML generator in prospect-mockups.ts. That module's own
// history (see its header comment) is why HTML became the primary path: an
// image can't be hand-tweaked and image models garble text and logos. This
// exists anyway for two callers: the operator who wants an actual generated
// visual rather than a screenshot of the HTML concept, and — the reason it
// now matters more — the layout-first flow, which uses a generated full-page
// image purely as a layout spec for the HTML pass, where garbled text is
// harmless because no copy is ever read off it.
//
// Two providers, unlike complete.ts's single vision path:
//
//   gemini (default when GEMINI_API_KEY is set) — the reason it's preferred is
//   ASPECT RATIO, not text quality. Its image API accepts 1:4 and 1:8, which
//   are real full-page-website proportions; gpt-image-1 tops out at 1024x1536
//   (2:3) and physically cannot compose a whole homepage, which is why every
//   concept generated before this came back as an above-the-fold crop. Gemini
//   renders legible text far better too, which matters for the standalone
//   image concept a prospect actually sees.
//
//   openai — kept as the fallback so deployments without a Gemini key keep
//   working, at the 2:3 ceiling described above.
//
// The Gemini call shape here was verified against @google/genai 2.16.0's own
// type definitions, not from memory or a blog post: ai.interactions.create
// ({ model, input, response_format }), input as typed text/image blocks with
// base64 `data`, output at interaction.output_image.data. The SDK moved to
// this Interactions API and away from models.generateContent — if you upgrade
// the SDK and this stops typechecking, re-read the .d.ts before guessing.

export type ImageGenProvider = 'openai' | 'gemini'

// Provider-neutral, because the two express size in incompatible ways: OpenAI
// takes fixed pixel dimensions, Gemini takes a ratio plus a size tier. Callers
// want "a whole page" or "a wide banner", not either vendor's vocabulary.
// 'photo' is an ordinary landscape content photo (hero/service imagery),
// distinct from 'full-page' (a whole homepage composition) and 'wide' (a
// banner-style crop) — see generateStockPhotos in prospect-mockups.ts.
export type ImageShape = 'full-page' | 'wide' | 'photo'

export interface ImageGenOptions {
  provider?: ImageGenProvider
  shape?: ImageShape
  // 'draft' is for images consumed by another model rather than shown to
  // anyone (the layout-first spec) — cheaper model, lower resolution, since
  // only the composition survives into the finished page anyway. Ignored by
  // the OpenAI path, which has one image model.
  tier?: 'draft' | 'final'
}

// Nano Banana Pro for anything a prospect will see; Nano Banana 2 (Flash) for
// throwaway layout drafts. Both overridable — repricing quality vs cost is
// config, not code, same posture as complete.ts's model constants.
const GEMINI_FINAL_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image'
const GEMINI_DRAFT_MODEL = process.env.GEMINI_IMAGE_DRAFT_MODEL ?? 'gemini-3.1-flash-image'
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1'

// 1:4 rather than the available 1:8: a real homepage runs roughly 1:4 to 1:8,
// but the taller the canvas the smaller every section renders, and this image
// exists to be read — by the HTML pass as a layout spec, or by a prospect as a
// concept. 1:8 is there if a page with many sections needs it.
const FULL_PAGE_RATIO = '1:4'

// gpt-image-1's tallest option, and the whole reason the OpenAI path is now
// the fallback — 2:3 is nowhere near a page, so a full-page composition on
// this provider is always a compromise.
const OPENAI_FULL_PAGE_SIZE = '1024x1536'
const OPENAI_WIDE_SIZE = '1536x1024'

let geminiClient: GoogleGenAI | null = null
function gemini(): GoogleGenAI {
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  return geminiClient
}

export function geminiImagesConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}

export function imageGenConfigured(): boolean {
  return geminiImagesConfigured() || !!process.env.OPENAI_API_KEY
}

function defaultProvider(): ImageGenProvider {
  return geminiImagesConfigured() ? 'gemini' : 'openai'
}

function mediaTypeToExt(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'png'
  }
}

// Generates ONE new image conditioned on the given reference images (design
// references + logo crop + current-site screenshot, in that order — same
// VisionImage[] buildGenerationContext() already assembles for the HTML
// path) and a single descriptive prompt.
//
// Returns the model id alongside the bytes because callers persist it as the
// provenance of a saved concept — with two providers and a draft/final split,
// "which model drew this" is no longer derivable from an env var.
export interface GeneratedImage {
  buffer: Buffer
  model: string
  // Providers don't agree on output format — Gemini's image API rejects
  // 'image/png' outright ("Supported values: 'image/jpeg'"), while OpenAI
  // returns PNG. Callers persist these bytes and serve them back over HTTP,
  // so they need the real type rather than a hardcoded assumption.
  mediaType: VisionMediaType
  // What this single image cost, in millionths of a USD. Priced here because
  // this is the only layer that knows which model and output resolution were
  // actually used — both of which move the price materially.
  costMicros: number
}

export async function generateMockupImage(
  prompt: string,
  images: VisionImage[],
  opts: ImageGenOptions = {}
): Promise<GeneratedImage> {
  const provider = opts.provider ?? defaultProvider()
  const shape = opts.shape ?? 'full-page'

  if (provider === 'gemini') return generateWithGemini(prompt, images, shape, opts.tier ?? 'final')
  return generateWithOpenAI(prompt, images, shape)
}

async function generateWithGemini(
  prompt: string,
  images: VisionImage[],
  shape: ImageShape,
  tier: 'draft' | 'final'
): Promise<GeneratedImage> {
  if (!geminiImagesConfigured()) throw new Error('GEMINI_API_KEY is not configured on this deployment')

  // Captions ride along as their own text blocks ahead of each image, exactly
  // as completeWithImages does for Claude — VisionImage carries a caption
  // precisely because "a reference to imitate" and "the prospect's current
  // site" must not read as interchangeable inputs. The OpenAI path below
  // can't do this, which is a real reason to prefer this one.
  const input = [
    ...images.flatMap(img => [
      { type: 'text' as const, text: img.caption },
      { type: 'image' as const, mime_type: img.mediaType, data: img.buffer.toString('base64') }
    ]),
    { type: 'text' as const, text: prompt }
  ]

  const model = tier === 'draft' ? GEMINI_DRAFT_MODEL : GEMINI_FINAL_MODEL
  const imageSize = shape === 'photo' ? '1K' : tier === 'draft' ? '2K' : '4K'
  const interaction = await gemini().interactions.create({
    model,
    input,
    response_format: {
      type: 'image',
      // JPEG because Gemini's image API rejects image/png here; see
      // GeneratedImage.mediaType.
      mime_type: 'image/jpeg',
      aspect_ratio: shape === 'full-page' ? FULL_PAGE_RATIO : shape === 'photo' ? '4:3' : '16:9',
      // A draft is only ever read by the HTML pass for composition, so 4K
      // would be paying for detail that never reaches the finished page.
      //
      // 'photo' is capped harder still, and for a different reason: content
      // photos get base64-embedded directly into the concept HTML, where
      // base64's ~33% overhead applies to every byte. A 4K photo measured
      // ~8.5MB, so two of them would produce a ~23MB document — unopenable in
      // a browser and far too large for the DB row. 1K is ample for a concept
      // mockup and keeps the whole page in the low hundreds of KB.
      image_size: imageSize
      // No `delivery` field: the SDK's types accept 'inline'/'uri', but the
      // API rejects the parameter outright ("Image delivery mode is not
      // supported"). Omitting it returns inline base64, which is what we want.
    }
  })

  const data = interaction.output_image?.data
  if (!data) throw new Error('Gemini image generation did not return image data')
  return {
    buffer: Buffer.from(data, 'base64'),
    model,
    mediaType: 'image/jpeg',
    costMicros: geminiImageCostMicros(model, imageSize),
  }
}

async function generateWithOpenAI(
  prompt: string,
  images: VisionImage[],
  shape: ImageShape
): Promise<GeneratedImage> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on this deployment')

  // images.edit takes bare files with no per-image captions and no system
  // slot, so which image is which has to be described positionally inside the
  // prompt string itself — see buildImagePrompt()'s "image N" callouts.
  const files = await Promise.all(
    images.map((img, i) => toFile(img.buffer, `reference-${i}.${mediaTypeToExt(img.mediaType)}`, { type: img.mediaType }))
  )

  const size = shape === 'full-page' ? OPENAI_FULL_PAGE_SIZE : OPENAI_WIDE_SIZE
  const res = await openai().images.edit({
    model: OPENAI_IMAGE_MODEL,
    image: files,
    prompt,
    size,
  })

  const b64 = res.data?.[0]?.b64_json
  if (!b64) throw new Error('Image generation did not return image data')
  return {
    buffer: Buffer.from(b64, 'base64'),
    model: OPENAI_IMAGE_MODEL,
    mediaType: 'image/png',
    costMicros: openaiImageCostMicros(size),
  }
}
