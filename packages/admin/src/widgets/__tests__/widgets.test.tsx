import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type {
  FieldDescriptor,
  ImageFieldDescriptor,
  ListFieldDescriptor,
  ObjectFieldDescriptor,
  RelationFieldDescriptor,
  SelectFieldDescriptor,
} from "patcms/advanced"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { BooleanWidget } from "../boolean-widget"
import { WidgetRegistryProvider } from "../context"
import { createWidgetRegistry, defineWidget, type WidgetServices } from "../contract"
import { DatetimeWidget, fromLocalInput, toDateInput, toLocalInput } from "../datetime-widget"
import { ImageWidget } from "../image-widget"
import { defaultWidgetRegistry, EDITABLE_FIELD_TYPES, WIDGETS } from "../index"
import { ListWidget } from "../list-widget"
import { NumberWidget } from "../number-widget"
import { ObjectWidget } from "../object-widget"
import { ReferenceSwatchWidget } from "../reference-swatch/reference-swatch"
import { RelationWidget } from "../relation-widget"
import { SelectWidget } from "../select-widget"
import { StringWidget } from "../string-widget"
import { TextWidget } from "../text-widget"

/**
 * Widget contract (ADR-0009): value in / value out, descriptor-driven labels,
 * "not set" = `undefined` (the key is removed, never invented as "" or 0), and
 * an accessible error surface. The registry is joined by name and must stay in
 * lockstep with the core vocabulary.
 */

function Harness<F extends FieldDescriptor>({
  initial,
  field,
  component: Component,
  error,
  onChange,
  services,
}: {
  readonly initial: unknown
  readonly field: F
  readonly component: (props: import("../contract").WidgetProps<F>) => React.ReactNode
  readonly error?: string
  readonly onChange?: (value: unknown) => void
  readonly services?: WidgetServices
}) {
  const [value, setValue] = useState<unknown>(initial)
  return (
    <WidgetRegistryProvider registry={defaultWidgetRegistry}>
      <Component
        value={value}
        fieldConfig={field}
        error={error}
        services={services}
        onChange={(next: unknown) => {
          setValue(next)
          onChange?.(next)
        }}
      />
    </WidgetRegistryProvider>
  )
}

const STRING: FieldDescriptor = {
  name: "title",
  label: "Title",
  required: true,
  type: "string",
  hint: "Shown on the card",
}

describe("widget registry", () => {
  it("binds all 11 Phase 3 types, all editable", () => {
    expect(WIDGETS.map((binding) => binding.fieldTypeName)).toEqual([
      "string",
      "text",
      "number",
      "boolean",
      "select",
      "datetime",
      "list",
      "object",
      "image",
      "relation",
      "swatch",
    ])
    expect([...EDITABLE_FIELD_TYPES].sort()).toEqual([
      "boolean",
      "datetime",
      "image",
      "list",
      "number",
      "object",
      "relation",
      "select",
      "string",
      "swatch",
      "text",
    ])
  })

  it("ADR-0009: matches the frozen registry snapshot", () => {
    expect(defaultWidgetRegistry.fieldTypeNames).toMatchInlineSnapshot(`
      [
        "string",
        "text",
        "number",
        "boolean",
        "select",
        "datetime",
        "list",
        "object",
        "image",
        "relation",
        "swatch",
      ]
    `)
  })

  it("refuses a duplicate binding instead of silently shadowing one", () => {
    const binding = defineWidget({ fieldTypeName: "string", Component: StringWidget })
    expect(() => createWidgetRegistry([binding, binding])).toThrow(/duplicate widget binding/)
  })

  it("looks widgets up by field type name", () => {
    const registry = createWidgetRegistry(WIDGETS)
    expect(registry.get("select")).toBeDefined()
    expect(registry.get("image")).toBeDefined()
    expect(registry.get("swatch")).toBeDefined()
    expect(registry.get("unknown_custom")).toBeUndefined()
  })
})

describe("string widget", () => {
  it("renders the descriptor label, hint and required marker", () => {
    render(<Harness initial={undefined} field={STRING} component={StringWidget} />)
    const input = screen.getByLabelText(/Title/)
    expect(input).toHaveProperty("tagName", "INPUT")
    expect(input.getAttribute("aria-describedby")).toContain("-hint")
    expect(screen.getByText("Shown on the card")).toBeDefined()
  })

  it("writes what the founder types and clears to undefined", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial="Old" field={STRING} component={StringWidget} onChange={onChange} />)
    const input = screen.getByLabelText(/Title/)
    await user.clear(input)
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    await user.type(input, "New")
    expect(onChange).toHaveBeenLastCalledWith("New")
  })

  it("surfaces a save-gate error accessibly", () => {
    render(
      <Harness
        initial=""
        field={STRING}
        component={StringWidget}
        error="This field is required."
      />,
    )
    const input = screen.getByLabelText(/Title/)
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByRole("alert").textContent).toBe("This field is required.")
  })
})

describe("text widget", () => {
  it("renders a textarea and writes multi-line text", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const field: FieldDescriptor = {
      name: "caption",
      label: "Caption",
      required: false,
      type: "text",
    }
    render(<Harness initial={undefined} field={field} component={TextWidget} onChange={onChange} />)
    const area = screen.getByLabelText("Caption")
    expect(area.tagName).toBe("TEXTAREA")
    await user.type(area, "Line one")
    expect(onChange).toHaveBeenLastCalledWith("Line one")
  })
})

describe("number widget", () => {
  const field: FieldDescriptor = { name: "price", label: "Price", required: false, type: "number" }

  it("writes finite numbers and never invents a zero", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness initial={undefined} field={field} component={NumberWidget} onChange={onChange} />,
    )
    const input = screen.getByLabelText("Price")
    await user.type(input, "12.5")
    expect(onChange).toHaveBeenLastCalledWith(12.5)
    await user.clear(input)
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it("shows the stored number", () => {
    render(<Harness initial={120} field={field} component={NumberWidget} />)
    expect((screen.getByLabelText("Price") as HTMLInputElement).value).toBe("120")
  })
})

describe("boolean widget", () => {
  const field: FieldDescriptor = {
    name: "featured",
    label: "Featured",
    required: false,
    type: "boolean",
  }

  it("writes true then false (false is real data)", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness initial={undefined} field={field} component={BooleanWidget} onChange={onChange} />,
    )
    const box = screen.getByLabelText("Featured")
    await user.click(box)
    expect(onChange).toHaveBeenLastCalledWith(true)
    await user.click(box)
    expect(onChange).toHaveBeenLastCalledWith(false)
  })
})

describe("select widget", () => {
  const field: FieldDescriptor = {
    name: "category",
    label: "Category",
    required: false,
    type: "select",
    options: [
      { label: "Pendants", value: "pendants" },
      { label: "Rings", value: "rings" },
    ],
  }

  it("writes the option value and clears to undefined", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness initial={undefined} field={field} component={SelectWidget} onChange={onChange} />,
    )
    const select = screen.getByLabelText("Category")
    await user.selectOptions(select, "Rings")
    expect(onChange).toHaveBeenLastCalledWith("rings")
    await user.selectOptions(select, "Not set")
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it("writes multiple values in descriptor order, not click order", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const multiple: FieldDescriptor = { ...field, name: "tags", label: "Tags", multiple: true }
    render(
      <Harness initial={undefined} field={multiple} component={SelectWidget} onChange={onChange} />,
    )
    await user.click(screen.getByLabelText("Rings"))
    await user.click(screen.getByLabelText("Pendants"))
    expect(onChange).toHaveBeenLastCalledWith(["pendants", "rings"])
    await user.click(screen.getByLabelText("Pendants"))
    await user.click(screen.getByLabelText("Rings"))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

describe("datetime widget", () => {
  const dateField: FieldDescriptor = {
    name: "publishedOn",
    label: "Published on",
    required: false,
    type: "datetime",
    dateOnly: true,
  }

  it("edits a date-only field as YYYY-MM-DD", () => {
    const onChange = vi.fn()
    render(
      <Harness
        initial="2024-05-01T10:00:00.000Z"
        field={dateField}
        component={DatetimeWidget}
        onChange={onChange}
      />,
    )
    const input = screen.getByLabelText("Published on")
    expect((input as HTMLInputElement).value).toBe("2024-05-01")
    fireEvent.change(input, { target: { value: "2024-06-02" } })
    expect(onChange).toHaveBeenLastCalledWith("2024-06-02")
    fireEvent.change(input, { target: { value: "" } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it("round-trips a date-time through the local input value", () => {
    const stored = "2024-05-01T10:30:00.000Z"
    const local = toLocalInput(stored)
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(new Date(fromLocalInput(local)).getTime()).toBe(new Date(stored).getTime())
  })

  it("keeps an unparseable value visible instead of blanking it", () => {
    expect(toDateInput("not-a-date")).toBe("not-a-date")
    expect(toLocalInput("not-a-date")).toBe("not-a-date")
  })
})

describe("reference swatch widget", () => {
  const swatchField: SelectFieldDescriptor = {
    name: "swatch",
    label: "Color Swatch",
    required: false,
    type: "select",
    options: [
      { label: "Gold", value: "accent" },
      { label: "Neutral", value: "muted" },
      { label: "Deep blue", value: "secondary" },
    ],
  }

  it("renders default yve swatches and handles selection", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness
        initial="accent"
        field={swatchField}
        component={ReferenceSwatchWidget}
        onChange={onChange}
      />,
    )
    const accentBtn = screen.getByTestId("swatch-option-accent")
    expect(accentBtn.getAttribute("aria-pressed")).toBe("true")

    const mutedBtn = screen.getByTestId("swatch-option-muted")
    expect(mutedBtn.getAttribute("aria-pressed")).toBe("false")
    await user.click(mutedBtn)
    expect(onChange).toHaveBeenLastCalledWith("muted")

    // Clicking active option when not required deselects to undefined
    await user.click(mutedBtn)
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

describe("image widget", () => {
  const imageField: ImageFieldDescriptor = {
    name: "photo",
    label: "Product Photo",
    required: false,
    type: "image",
  }

  it("renders preview and writes typed file path", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness
        initial="/images/products/lamp.jpg"
        field={imageField}
        component={ImageWidget}
        onChange={onChange}
      />,
    )
    const input = screen.getByPlaceholderText("/images/products/example.jpg")
    expect((input as HTMLInputElement).value).toBe("/images/products/lamp.jpg")
    await user.clear(input)
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    await user.type(input, "/images/products/new.png")
    expect(onChange).toHaveBeenLastCalledWith("/images/products/new.png")
  })
})

describe("relation widget", () => {
  const relationField: RelationFieldDescriptor = {
    name: "featuredProduct",
    label: "Featured Product",
    required: false,
    type: "relation",
    collection: "products",
  }

  const mockServices: WidgetServices = {
    getEntries: vi.fn().mockReturnValue([
      {
        slug: "iris-no-7",
        title: "Iris No. 7",
        collection: "products",
        value: {},
      } as unknown as import("../../runtime/entry-index").IndexedEntry,
      {
        slug: "the-rock-no-1",
        title: "The Rock No. 1",
        collection: "products",
        value: {},
      } as unknown as import("../../runtime/entry-index").IndexedEntry,
    ]),
    getEntryBySlug: vi.fn((_coll, slug) => {
      if (slug === "iris-no-7") {
        return {
          slug: "iris-no-7",
          title: "Iris No. 7",
          collection: "products",
          value: {},
        } as unknown as import("../../runtime/entry-index").IndexedEntry
      }
      return undefined
    }),
    searchEntries: vi.fn().mockReturnValue([]),
  }

  it("resolves and renders the selected relation title", () => {
    render(
      <Harness
        initial="iris-no-7"
        field={relationField}
        component={RelationWidget}
        services={mockServices}
      />,
    )
    expect(screen.getByText("Iris No. 7")).toBeDefined()
  })

  it("displays warning chip and remove action for removed references", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness
        initial="deleted-item"
        field={relationField}
        component={RelationWidget}
        services={mockServices}
        onChange={onChange}
      />,
    )
    expect(screen.getByText("Reference to a removed product")).toBeDefined()
    const removeBtn = screen.getByLabelText(/Remove reference/i)
    await user.click(removeBtn)
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it("filters candidate entries and selects one", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness
        initial={undefined}
        field={relationField}
        component={RelationWidget}
        services={mockServices}
        onChange={onChange}
      />,
    )
    const searchInput = screen.getByPlaceholderText(/search/i)
    await user.type(searchInput, "rock")
    const option = screen.getByText("The Rock No. 1")
    await user.click(option)
    expect(onChange).toHaveBeenLastCalledWith("the-rock-no-1")
  })
})

describe("object widget", () => {
  const objectField: ObjectFieldDescriptor = {
    name: "contact",
    label: "Contact",
    required: false,
    type: "object",
    fields: [
      { name: "email", label: "Email", required: false, type: "string" },
      { name: "phone", label: "Phone", required: false, type: "string" },
    ],
  }

  it("renders subfields and updates record immutably", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness
        initial={{ email: "info@example.com" }}
        field={objectField}
        component={ObjectWidget}
        onChange={onChange}
      />,
    )
    const emailInput = screen.getByLabelText("Email")
    expect((emailInput as HTMLInputElement).value).toBe("info@example.com")

    const phoneInput = screen.getByLabelText("Phone")
    await user.type(phoneInput, "123456")
    expect(onChange).toHaveBeenLastCalledWith({
      email: "info@example.com",
      phone: "123456",
    })
  })
})

describe("list widget", () => {
  const listField: ListFieldDescriptor = {
    name: "images",
    label: "Images",
    required: false,
    type: "list",
    itemMode: "object",
    min: 1,
    max: 3,
    summary: "{{fields.alt}}",
    fields: [{ name: "alt", label: "Alt Text", required: false, type: "string" }],
  }

  it("renders items, summary text, and handles drag-free reordering", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const initialItems = [{ alt: "First image" }, { alt: "Second image" }]
    render(
      <Harness
        initial={initialItems}
        field={listField}
        component={ListWidget}
        onChange={onChange}
      />,
    )
    expect(screen.getByText("First image")).toBeDefined()
    expect(screen.getByText("Second image")).toBeDefined()

    // Move first item down
    const moveDownBtn = screen.getByLabelText("Move item 1 down")
    await user.click(moveDownBtn)
    expect(onChange).toHaveBeenLastCalledWith([{ alt: "Second image" }, { alt: "First image" }])
  })

  it("enforces min guardrail (disables remove button when at min)", () => {
    render(<Harness initial={[{ alt: "Only one" }]} field={listField} component={ListWidget} />)
    const removeBtn = screen.getByLabelText("Remove item 1")
    expect((removeBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it("enforces max guardrail (disables add button when at max)", () => {
    render(
      <Harness
        initial={[{ alt: "Item 1" }, { alt: "Item 2" }, { alt: "Item 3" }]}
        field={listField}
        component={ListWidget}
      />,
    )
    expect(screen.queryByText("+ Add Image")).toBeNull()
    expect(screen.getByText("At most 3 items allowed")).toBeDefined()
  })
})
