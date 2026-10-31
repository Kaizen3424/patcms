import type React from "react"
import { createContext, useContext } from "react"
import type { WidgetRegistry } from "./contract"

const WidgetRegistryContext = createContext<WidgetRegistry | undefined>(undefined)

export function WidgetRegistryProvider({
  registry,
  children,
}: {
  readonly registry: WidgetRegistry
  readonly children: React.ReactNode
}) {
  return (
    <WidgetRegistryContext.Provider value={registry}>{children}</WidgetRegistryContext.Provider>
  )
}

export function useWidgetRegistry(): WidgetRegistry {
  const context = useContext(WidgetRegistryContext)
  if (context === undefined) {
    throw new Error("useWidgetRegistry must be used within a WidgetRegistryProvider")
  }
  return context
}
