import type { ListFieldDescriptor } from "@mycms/core"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { WidgetRegistryProvider } from "../context"
import { defaultWidgetRegistry } from "../index"
import { ListWidget } from "../list-widget"

function Harness({
  initial,
  field,
  onChange,
}: {
  readonly initial: unknown[]
  readonly field: ListFieldDescriptor
  readonly onChange?: (val: unknown) => void
}) {
  const [val, setVal] = useState<unknown>(initial)
  return (
    <WidgetRegistryProvider registry={defaultWidgetRegistry}>
      <ListWidget
        value={val}
        error={undefined}
        onChange={(next) => {
          setVal(next)
          onChange?.(next)
        }}
        fieldConfig={field}
      />
    </WidgetRegistryProvider>
  )
}

describe("ListWidget a11y & reorder announcements (P5.8)", () => {
  const listField: ListFieldDescriptor = {
    name: "items",
    label: "Items",
    required: false,
    type: "list",
    itemMode: "object",
    summary: "{{fields.title}}",
    fields: [{ name: "title", label: "Title", required: false, type: "string" }],
  }

  it("announces 'Item X of Y moved to position Z' with aria-live='polite' on move down", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const initialItems = [{ title: "Alpha" }, { title: "Beta" }, { title: "Gamma" }]

    const { container } = render(
      <Harness initial={initialItems} field={listField} onChange={onChange} />,
    )

    const liveRegion = container.querySelector('[aria-live="polite"]')
    expect(liveRegion).not.toBeNull()

    const moveDownBtn = screen.getByLabelText("Move item 1 down")
    await user.click(moveDownBtn)

    expect(liveRegion?.textContent).toBe("Item 1 of 3 moved to position 2")
    expect(onChange).toHaveBeenCalledWith([
      { title: "Beta" },
      { title: "Alpha" },
      { title: "Gamma" },
    ])
  })

  it("announces 'Item X of Y moved to position Z' on move up", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const initialItems = [{ title: "Alpha" }, { title: "Beta" }, { title: "Gamma" }]

    const { container } = render(
      <Harness initial={initialItems} field={listField} onChange={onChange} />,
    )

    const liveRegion = container.querySelector('[aria-live="polite"]')
    const moveUpBtn = screen.getByLabelText("Move item 3 up")
    await user.click(moveUpBtn)

    expect(liveRegion?.textContent).toBe("Item 3 of 3 moved to position 2")
    expect(onChange).toHaveBeenCalledWith([
      { title: "Alpha" },
      { title: "Gamma" },
      { title: "Beta" },
    ])
  })

  it("disables boundary move buttons", () => {
    const initialItems = [{ title: "Alpha" }, { title: "Beta" }]
    render(<Harness initial={initialItems} field={listField} />)

    const item1Up = screen.getByLabelText("Move item 1 up") as HTMLButtonElement
    const item1Down = screen.getByLabelText("Move item 1 down") as HTMLButtonElement
    const item2Up = screen.getByLabelText("Move item 2 up") as HTMLButtonElement
    const item2Down = screen.getByLabelText("Move item 2 down") as HTMLButtonElement

    expect(item1Up.disabled).toBe(true)
    expect(item1Down.disabled).toBe(false)
    expect(item2Up.disabled).toBe(false)
    expect(item2Down.disabled).toBe(true)
  })
})
