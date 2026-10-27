import type { FieldDescriptor } from "@mycms/core"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { BooleanWidget } from "../boolean-widget"
import { createWidgetRegistry, defineWidget } from "../contract"
import { DatetimeWidget, fromLocalInput, toDateInput, toLocalInput } from "../datetime-widget"
import { EDITABLE_FIELD_TYPES, WIDGETS } from "../index"
import { NumberWidget } from "../number-widget"
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
}: {
  readonly initial: unknown
  readonly field: F
  readonly component: (props: {
    value: unknown
    onChange: (value: unknown) => void
    error: string | undefined
    fieldConfig: F
  }) => React.ReactNode
  readonly error?: string
  readonly onChange?: (value: unknown) => void
}) {
  const [value, setValue] = useState<unknown>(initial)
  return (
    <Component
      value={value}
      fieldConfig={field}
      error={error}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
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
  it("binds exactly the six P2.6 types, all editable", () => {
    expect(WIDGETS.map((binding) => binding.fieldTypeName)).toEqual([
      "string",
      "text",
      "number",
      "boolean",
      "select",
      "datetime",
    ])
    expect([...EDITABLE_FIELD_TYPES].sort()).toEqual([
      "boolean",
      "datetime",
      "number",
      "select",
      "string",
      "text",
    ])
  })

  it("refuses a duplicate binding instead of silently shadowing one", () => {
    const binding = defineWidget({ fieldTypeName: "string", Component: StringWidget })
    expect(() => createWidgetRegistry([binding, binding])).toThrow(/duplicate widget binding/)
  })

  it("looks widgets up by field type name", () => {
    const registry = createWidgetRegistry(WIDGETS)
    expect(registry.get("select")).toBeDefined()
    expect(registry.get("image")).toBeUndefined()
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
