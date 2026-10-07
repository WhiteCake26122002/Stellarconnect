"use client";

import { ComponentType, InputHTMLAttributes, KeyboardEvent, ReactNode, SVGProps, useState } from "react";
import { LockIcon } from "./icons";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id: string;
  label: string;
};

/** Label + input with an optional leading icon. Names, ids and autocomplete pass straight through. */
export function AuthField({
  id,
  label,
  icon: Icon,
  ...input
}: FieldProps & { icon?: ComponentType<SVGProps<SVGSVGElement>> }) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className={`auth-input${Icon ? "" : " no-icon"}`}>
        {Icon ? <Icon className="auth-ico" /> : null}
        <input id={id} {...input} />
      </div>
    </div>
  );
}

/** Password input with a Show/Hide toggle and a Caps Lock hint. `children` render under the field. */
export function PasswordField({
  id,
  label,
  children,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...input
}: Omit<FieldProps, "type"> & { children?: ReactNode }) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const track = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState("CapsLock"));
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input has-action">
        <LockIcon className="auth-ico" />
        <input
          id={id}
          {...input}
          type={shown ? "text" : "password"}
          onKeyDown={(e) => {
            track(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            track(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCaps(false);
            onBlur?.(e);
          }}
        />
        <button type="button" className="auth-reveal" onClick={() => setShown((s) => !s)} aria-controls={id}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {caps ? (
        <p className="auth-caps" role="status">
          Caps Lock is on
        </p>
      ) : null}
      {children}
    </div>
  );
}
