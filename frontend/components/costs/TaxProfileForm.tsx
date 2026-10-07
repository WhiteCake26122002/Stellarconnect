"use client";

import "./cx.css";
import { profileComplete } from "@/lib/costs/profile";
import { incomeBands, type TaxProfile } from "@/lib/costs/tax";

const SLABS = [0, 5, 10, 15, 20, 25, 30];

/**
 * The few personal inputs a tax estimate can use. All optional: without them the estimate says it is
 * before surcharge and cess and leaves slab-rate gains unpriced, rather than pretending to know.
 */
export function TaxProfileForm({ profile, onChange }: { profile: TaxProfile; onChange: (next: TaxProfile) => void }) {
  return (
    <fieldset className="cx-profile">
      <legend>Your tax details <span className="cx-quiet-text">optional</span></legend>
      <p className="cx-quiet-text">
        These stay in this browser. Leave them blank and every estimate is shown before surcharge and cess, with gains taxed at slab rate left unpriced.
      </p>
      <div className="cx-fields">
        <label>
          <span>Total income</span>
          <select value={profile.incomeBand ?? ""} onChange={(e) => onChange({ ...profile, incomeBand: e.target.value || null })}>
            <option value="">Not set</option>
            {incomeBands().map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
          <small>Decides the surcharge.</small>
        </label>
        <label>
          <span>Slab rate</span>
          <select value={profile.slabRatePct == null ? "" : String(profile.slabRatePct)} onChange={(e) => onChange({ ...profile, slabRatePct: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Not set</option>
            {SLABS.map((s) => (
              <option key={s} value={s}>{s}%</option>
            ))}
          </select>
          <small>Prices gains taxed at your slab rate.</small>
        </label>
        <label>
          <span>Tax regime</span>
          <select value={profile.regime} onChange={(e) => onChange({ ...profile, regime: e.target.value === "old" ? "old" : "new" })}>
            <option value="new">New regime</option>
            <option value="old">Old regime</option>
          </select>
          <small>Only changes surcharge at the highest incomes.</small>
        </label>
      </div>
      <p className={`cx-quiet-text ${profileComplete(profile) ? "cx-ok" : ""}`}>
        {profileComplete(profile) ? "Profile complete: estimates include surcharge and cess." : "Profile incomplete: estimates are before surcharge and cess."}
      </p>
    </fieldset>
  );
}
