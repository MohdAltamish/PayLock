import {
  createContext,
  forwardRef,
  useContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

interface FieldContextValue {
  id: string;
  describedBy?: string;
  hasError: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function useField() {
  return useContext(FieldContext);
}

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, hasError: Boolean(error) }}>
      <div className={cn("flex flex-col space-y-1.5", className)}>
        <label htmlFor={id} className="text-[15px] font-bold text-text">
          {label}
        </label>
        <div className="relative">{children}</div>
        {hint && !error && (
          <p id={hintId} className="text-xs text-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, id, error, "aria-describedby": ariaDescribedBy, ...props },
  ref,
) {
  const field = useField();
  const inputId = id ?? field?.id;
  const isError = error ?? field?.hasError;
  const describedBy = ariaDescribedBy ?? field?.describedBy;

  return (
    <input
      ref={ref}
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={isError ? true : undefined}
      className={cn(
        "w-full rounded-control border bg-surface px-3.5 py-2.5 text-[16px] text-text placeholder:text-muted/60 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        isError
          ? "border-danger focus-visible:outline-danger"
          : "border-border hover:border-slate-300",
        className,
      )}
      {...props}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, id, error, "aria-describedby": ariaDescribedBy, ...props },
  ref,
) {
  const field = useField();
  const inputId = id ?? field?.id;
  const isError = error ?? field?.hasError;
  const describedBy = ariaDescribedBy ?? field?.describedBy;

  return (
    <textarea
      ref={ref}
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={isError ? true : undefined}
      className={cn(
        "w-full rounded-control border bg-surface px-3.5 py-2.5 text-[16px] text-text placeholder:text-muted/60 transition-colors min-h-[100px]",
        "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        isError
          ? "border-danger focus-visible:outline-danger"
          : "border-border hover:border-slate-300",
        className,
      )}
      {...props}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, id, error, "aria-describedby": ariaDescribedBy, children, ...props },
  ref,
) {
  const field = useField();
  const inputId = id ?? field?.id;
  const isError = error ?? field?.hasError;
  const describedBy = ariaDescribedBy ?? field?.describedBy;

  return (
    <select
      ref={ref}
      id={inputId}
      aria-describedby={describedBy}
      aria-invalid={isError ? true : undefined}
      className={cn(
        "w-full rounded-control border bg-surface px-3.5 py-2.5 text-[16px] text-text transition-colors cursor-pointer",
        "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        isError
          ? "border-danger focus-visible:outline-danger"
          : "border-border hover:border-slate-300",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
