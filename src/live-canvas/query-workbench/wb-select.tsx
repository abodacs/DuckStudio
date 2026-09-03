import * as SelectPrimitive from "@radix-ui/react-select";

/** One picker option: the submitted value and its display word. */
export interface WbSelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The workbench's select (shadcn shape, Custody Glass skin): the Radix
 * Select primitive under a trigger dressed as `wb-field`, so the picked
 * value reads ink-on-dark at the same size as the typed inputs — the
 * native select's dark-on-dark option list is unreadable, which is the
 * defect this replaces. The content is floating glass, the one place
 * backdrop-blur is allowed off the fixed chrome (the blur budget rule).
 */
export function WbSelect(props: {
  label: string;
  value: string;
  options: readonly WbSelectOption[];
  onValueChange: (value: string) => void;
}) {
  return (
    <SelectPrimitive.Root value={props.value} onValueChange={props.onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={props.label}
        className="wb-field group inline-flex cursor-pointer items-center justify-between gap-2 data-[state=open]:border-accent/40"
      >
        <SelectPrimitive.Value />
        <svg
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden
          className="size-2.5 shrink-0 text-ink-secondary transition-transform duration-300 ease-glide group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        >
          <path
            d="M1 1l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          sideOffset={6}
          className="wb-pop z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-panel-inner border border-edge bg-canvas/90 p-1 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.65),inset_0_1px_0_rgb(255_255_255/0.07)] backdrop-blur-md"
        >
          <SelectPrimitive.Viewport>
            {props.options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-[calc(var(--radius-panel-inner)_-_4px)] px-2 py-1.5 font-mono text-xs text-ink-secondary outline-none data-highlighted:bg-white/[0.06] data-highlighted:text-ink data-[state=checked]:text-accent"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="shrink-0 text-accent">
                  <svg viewBox="0 0 12 12" fill="none" aria-hidden className="size-3">
                    <path
                      d="M2.5 6.5l2.5 2.5 4.5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
