/**
 * yve fixture config — the exact 14-file shape from the frozen inventory
 * (plans/phase-7-publish.md, appendix A), reduced to the P1 read-side widget set.
 * Complex presentation blocks that P3 will model stay `hidden` so their bytes
 * are preserved untouched (ADR-0003, INV-S03).
 */
import * as fields from "@mycms/core"
import { defineCollection, defineConfig, defineFiles, toAdminConfig } from "@mycms/core"
import { z } from "zod"

const productMedia = { folder: "public/images/products", publicFolder: "/images/products" } as const
const collectionMedia = {
  folder: "public/images/collections",
  publicFolder: "/images/collections",
} as const
const siteMedia = { folder: "public/images/site", publicFolder: "/images/site" } as const

const seo = fields.hidden({ label: "SEO" })
const categoryOptions = [
  { label: "Table Lamps", value: "Table Lamps" },
  { label: "Pendant Lights", value: "Pendant Lights" },
  { label: "Custom", value: "Custom" },
] as const

const image = fields.image({ label: "Image", required: false })
const imageAlt = fields.string({ label: "Image alt text", required: false })
const title = fields.string({ label: "Title", required: true })
const optionalString = (label: string) => fields.string({ label, required: false })
const optionalText = (label: string) => fields.text({ label, required: false })

const imageItem = {
  image: fields.image({ label: "Photo", required: false }),
  alt: fields.string({ label: "Alt text", required: false }),
  objectPosition: fields.hidden({ label: "Crop focus", defaultValue: "center" }),
}

const productImages = fields.list({
  label: "Photos",
  required: false,
  min: 1,
  max: 3,
  summary: "{{fields.alt}}",
  fields: imageItem,
})

const contact = fields.object({
  label: "Contact",
  required: false,
  fields: {
    email: fields.string({ label: "Email", required: false, format: "email" }),
    phone: fields.string({ label: "Phone", required: false }),
  },
})

const people = fields.list({
  label: "People",
  required: false,
  min: 1,
  summary: "{{fields.name}}",
  fields: {
    name: fields.string({ label: "Name", required: true }),
    bio: fields.text({ label: "Bio", required: true }),
  },
})

const featuredProduct = fields.relation({
  label: "Featured product",
  required: false,
  collection: "products",
  valueField: "{{slug}}",
  displayFields: ["title"],
})

const swatchOptions = [
  { label: "Gold", value: "accent" },
  { label: "Neutral", value: "muted" },
  { label: "Deep blue", value: "secondary" },
] as const

const productOptions = fields.list({
  label: "Options",
  required: false,
  min: 1,
  summary: "{{fields.name}}",
  fields: {
    name: fields.string({ label: "Name", required: true }),
    values: fields.list({
      label: "Values",
      required: true,
      min: 1,
      summary: "{{fields.label}}",
      fields: {
        label: fields.string({ label: "Label", required: true }),
        swatch: fields.select({
          label: "Color Swatch",
          required: false,
          defaultValue: "accent",
          options: swatchOptions,
        }),
      },
    }),
  },
})

const productAccordions = fields.list({
  label: "Accordions",
  required: false,
  summary: "{{fields.title}}",
  fields: {
    title: fields.string({ label: "Title", required: true }),
    body: fields.text({ label: "Body", required: true }),
  },
})

const productsSchema = z.object({
  title,
  slug: fields.slug(),
  kicker: fields.hidden({ label: "Kicker", defaultValue: "" }),
  displayName: optionalString("Display name"),
  material: optionalString("Material"),
  price: fields.number({ label: "Price", required: false, int: true, min: 0 }),
  pricePrefix: optionalString("Price prefix"),
  category: fields.select({ label: "Category", required: false, options: categoryOptions }),
  materialFilter: fields.hidden({ label: "Material filter", defaultValue: "Ceramics" }),
  description: optionalText("Description"),
  images: productImages,
  specs: fields.list({
    label: "Specs",
    required: false,
    summary: "{{fields.label}}: {{fields.value}}",
    fields: {
      label: fields.string({ label: "Label", required: false }),
      value: fields.string({ label: "Value", required: false }),
    },
  }),
  options: productOptions,
  accordions: productAccordions,
  seo,
})

const driftSchema = z.object({
  title,
  price: fields.number({ label: "Price", required: false, int: true, min: 0 }),
  category: fields.select({ label: "Category", required: false, options: categoryOptions }),
  people,
  contact,
  featured: featuredProduct,
  images: productImages,
  materialFilter: fields.hidden({ label: "Material filter", defaultValue: "Ceramics" }),
})

const collectionsSchema = z.object({
  number: optionalString("Number"),
  title,
  slug: fields.slug(),
  subtitle: optionalString("Subtitle"),
  theme: fields.select({
    label: "Theme",
    required: false,
    options: [
      { label: "Natural", value: "natural" },
      { label: "Iris", value: "iris" },
    ],
  }),
  image,
  imageAlt,
  heroObjectPosition: fields.hidden({ label: "Hero crop focus", defaultValue: "center" }),
  indexObjectPosition: fields.hidden({ label: "Index crop focus", defaultValue: "center" }),
  heroKicker: fields.hidden({ label: "Hero kicker", defaultValue: "" }),
  intro: optionalText("Intro"),
  mood: fields.hidden({ label: "Mood", defaultValue: "" }),
  paletteLabels: fields.hidden({ label: "Palette labels", defaultValue: "" }),
  sectionTitle: optionalString("Section title"),
  sectionTitleAccent: fields.hidden({ label: "Section title accent", defaultValue: "" }),
  sectionBody: optionalText("Section body"),
  ctaLabel: optionalString("CTA label"),
  featuredProducts: fields.relation({
    label: "Featured products",
    required: false,
    collection: "products",
    multiple: true,
    valueField: "{{slug}}",
    displayFields: ["title"],
    searchFields: ["title", "material"],
  }),
  seo,
})

const homeSchema = z.object({
  kicker: fields.hidden({ label: "Kicker", defaultValue: "" }),
  titleLine1: fields.string({ label: "Title line 1", required: true }),
  titleLine2: fields.string({ label: "Title line 2", required: true }),
  intro: fields.text({ label: "Intro", required: true }),
  ctaLabel: fields.string({ label: "CTA label", required: true }),
  image: fields.image({ label: "Image", required: true }),
  imageAlt: fields.string({ label: "Image alt text", required: true }),
  studyLabel: fields.string({ label: "Study label", required: true }),
  studyProduct: fields.relation({
    label: "Study product",
    required: false,
    collection: "products",
    valueField: "{{slug}}",
    displayFields: ["title"],
  }),
  seo,
})

const collectionsPageSchema = z.object({
  kicker: fields.hidden({ label: "Kicker", defaultValue: "" }),
  titleLine1: fields.string({ label: "Title line 1", required: true }),
  titleLine2: fields.string({ label: "Title line 2", required: true }),
  intro: fields.text({ label: "Intro", required: true }),
  seo,
})

const craftFeatures = fields.list({
  label: "Features",
  required: false,
  min: 4,
  max: 4,
  summary: "{{fields.title}}",
  fields: {
    title: fields.string({ label: "Title", required: true }),
    text: fields.text({ label: "Text", required: true }),
    icon: fields.hidden({ label: "Icon" }),
  },
})

const craftSchema = z.object({
  kicker: fields.hidden({ label: "Kicker", defaultValue: "" }),
  titleLine1: fields.string({ label: "Title line 1", required: false }),
  titleLine2: fields.string({ label: "Title line 2", required: false }),
  image,
  imageAlt,
  statValue: optionalString("Stat value"),
  statTitle: optionalString("Stat title"),
  statBody: optionalText("Stat body"),
  features: craftFeatures,
  ceramicKicker: fields.hidden({ label: "Ceramic kicker", defaultValue: "" }),
  ceramicTitleLine1: optionalString("Ceramic title line 1"),
  ceramicTitleLine2: optionalString("Ceramic title line 2"),
  ceramicBody: optionalText("Ceramic body"),
  ceramicImage: currentImage("Ceramic image"),
  ceramicImageAlt: optionalString("Ceramic image alt text"),
  seo,
})

function currentImage(label: string) {
  return fields.image({ label, required: false })
}

const aboutSchema = z.object({
  kicker: fields.hidden({ label: "Kicker", defaultValue: "" }),
  titleLine1: fields.string({ label: "Title line 1", required: false }),
  titleLine2: fields.string({ label: "Title line 2", required: false }),
  image,
  imageAlt,
  quoteKicker: fields.hidden({ label: "Quote kicker", defaultValue: "" }),
  quote: optionalText("Quote"),
  people: fields.list({
    label: "People",
    required: false,
    min: 1,
    summary: "{{fields.name}}",
    fields: {
      name: fields.string({ label: "Name", required: true }),
      bio: fields.text({ label: "Bio", required: true }),
    },
  }),
  enquiryKicker: fields.hidden({ label: "Enquiry kicker", defaultValue: "" }),
  enquiryTitleLine1: optionalString("Enquiry title line 1"),
  enquiryTitleLine2: optionalString("Enquiry title line 2"),
  enquiryBody: optionalText("Enquiry body"),
  form: fields.hidden({ label: "Form copy" }),
  seo,
})

const bespokeDiameters = fields.list({
  label: "Diameters",
  required: false,
  min: 1,
  summary: "{{fields.value}} cm",
  fields: {
    value: fields.number({ label: "Diameter (cm)", required: true, min: 1 }),
    surcharge: fields.number({ label: "Surcharge (€)", required: true, int: true, min: 0 }),
  },
})

const bespokeFinishes = fields.list({
  label: "Finishes",
  required: false,
  min: 1,
  summary: "{{fields.label}}",
  fields: {
    label: fields.string({ label: "Label", required: true }),
    surcharge: fields.number({ label: "Surcharge (€)", required: true, int: true, min: 0 }),
  },
})

const bespokeSchema = z.object({
  kicker: fields.hidden({ label: "Kicker", defaultValue: "" }),
  titleLine1: optionalString("Title line 1"),
  titleLine2: optionalString("Title line 2"),
  intro: optionalText("Intro"),
  image,
  imageAlt,
  steps: fields.hidden({ label: "Steps" }),
  shapes: fields.hidden({ label: "Shapes" }),
  diameters: bespokeDiameters,
  finishes: bespokeFinishes,
  piping: fields.hidden({ label: "Piping" }),
  basePrice: fields.number({ label: "Base price", required: true, int: true, min: 0 }),
  backLabel: optionalString("Back label"),
  continueLabel: optionalString("Continue label"),
  previewLabel: optionalString("Preview label"),
  seo,
})

const siteSchema = z.object({
  brand: fields.hidden({ label: "Brand" }),
  nav: fields.hidden({ label: "Navigation" }),
  footer: fields.hidden({ label: "Footer" }),
  contact: fields.object({
    label: "Contact details",
    required: false,
    fields: {
      email: fields.string({ label: "Email", required: false, format: "email" }),
      phone: fields.string({ label: "Phone", required: false }),
      locationLines: fields.list({
        label: "Address lines",
        required: false,
        field: { name: "line", schema: fields.string({ label: "Line", required: true }) },
      }),
    },
  }),
})

const pages = [
  {
    name: "home",
    label: "Home",
    file: "src/content/home.json",
    schema: homeSchema,
  },
  {
    name: "collections-page",
    label: "Collections page",
    file: "src/content/collections-page.json",
    schema: collectionsPageSchema,
  },
  {
    name: "craft",
    label: "Craft",
    file: "src/content/craft.json",
    schema: craftSchema,
  },
  {
    name: "about",
    label: "About",
    file: "src/content/about.json",
    schema: aboutSchema,
  },
  {
    name: "bespoke",
    label: "Bespoke studio",
    file: "src/content/bespoke.json",
    schema: bespokeSchema,
  },
] as const

export const yveConfig = defineConfig({
  site: { name: "ING & YVE", url: "https://ingandyve.nl" },
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [
    defineCollection({
      name: "products",
      label: "Products",
      labelSingular: "Product",
      icon: "lamp",
      folder: "src/content/products",
      format: "json",
      create: true,
      delete: false,
      identifierField: "title",
      summary: "{{title}} · € {{price}}",
      previewPath: "/product/{{slug}}",
      sortableFields: ["title", "price", "slug", "category"],
      thumbnail: "images.0.image",
      viewGroups: [
        { name: "table-lamps", label: "Table lamps", field: "category", pattern: "^Table Lamps$" },
        {
          name: "pendant-lights",
          label: "Pendant lights",
          field: "category",
          pattern: "^Pendant Lights$",
        },
        { name: "custom", label: "Custom", field: "category", pattern: "^Custom$" },
      ],
      media: productMedia,
      schema: productsSchema,
      decorations: [
        { before: "category", label: "Organisation" },
        { before: "images", label: "Photography" },
      ],
    }),
    defineCollection({
      name: "collections",
      label: "Collections",
      labelSingular: "Collection",
      icon: "layers",
      folder: "src/content/collections",
      format: "json",
      create: true,
      delete: false,
      identifierField: "title",
      summary: "{{number}} — {{title}}",
      previewPath: "/collections/{{slug}}",
      sortableFields: ["number", "title", "slug"],
      thumbnail: "image",
      media: collectionMedia,
      schema: collectionsSchema,
    }),
    defineFiles({
      name: "pages",
      label: "Pages",
      icon: "menu_book",
      media: siteMedia,
      files: pages,
    }),
    defineFiles({
      name: "settings",
      label: "Settings",
      icon: "tune",
      files: [
        {
          name: "contact-details",
          label: "Contact details",
          icon: "contact_mail",
          file: "src/content/site.json",
          schema: siteSchema,
        },
      ],
    }),
    defineCollection({
      name: "drift",
      label: "Drift fixtures",
      labelSingular: "Drift entry",
      icon: "science",
      folder: "src/content/drift",
      format: "json",
      create: true,
      delete: false,
      identifierField: "title",
      summary: "{{title}}",
      sortableFields: ["title", "slug"],
      media: productMedia,
      schema: driftSchema,
    }),
  ],
})

export const yveAdminConfig = toAdminConfig(yveConfig)
