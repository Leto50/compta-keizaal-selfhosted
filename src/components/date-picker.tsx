import { CalendarDays } from "lucide-react"
import { useState } from "react"
import { type Matcher } from "react-day-picker"
import { fr } from "react-day-picker/locale"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  formatDateLabel,
  formatDateValue,
  parseDateValue,
} from "@/lib/date-values"
import { cn } from "@/lib/utils"

interface DatePickerProps {
  ariaInvalid?: boolean
  ariaLabel: string
  className?: string
  disabled?: boolean
  display?: "long" | "short"
  id: string
  max?: string
  min?: string
  name?: string
  onBlur?: () => void
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  value: string
}

export function DatePicker({
  ariaInvalid = false,
  ariaLabel,
  className,
  disabled = false,
  display = "long",
  id,
  max,
  min,
  name,
  onBlur,
  onChange,
  placeholder = "Choisir une date",
  required = false,
  value,
}: Readonly<DatePickerProps>) {
  const [open, setOpen] = useState(false)
  const selectedDate = parseDateValue(value)
  const minimumDate = parseDateValue(min)
  const maximumDate = parseDateValue(max)
  const disabledDates: Matcher[] = [
    ...(minimumDate ? [{ before: minimumDate }] : []),
    ...(maximumDate ? [{ after: maximumDate }] : []),
  ]

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          aria-required={required}
          className={cn(
            "h-9 w-full justify-start bg-background/50 text-left font-normal",
            !selectedDate && "text-muted-foreground",
            className
          )}
          disabled={disabled}
          id={id}
          name={name}
          onBlur={onBlur}
          type="button"
          variant="outline"
        >
          <CalendarDays aria-hidden="true" />
          <span className="truncate">
            {selectedDate
              ? formatDateLabel(selectedDate, display)
              : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          defaultMonth={selectedDate}
          disabled={disabledDates}
          locale={fr}
          mode="single"
          onSelect={(date) => {
            if (!date) return
            onChange(formatDateValue(date))
            setOpen(false)
          }}
          selected={selectedDate}
        />
        {!required && selectedDate ? (
          <div className="border-t border-border/60 p-2">
            <Button
              className="w-full"
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Effacer la date
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
