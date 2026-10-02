"use client";

import { MONOPOLY_ANIMALS, type MonopolyAnimal } from "@fourman/shared";
import { createContext, useContext } from "react";
import { animalLabel, animalSrc, tokenColor } from "../lib/look";

/** Looks up a player's animal by engine id; the room page provides it from the seats. */
export const AnimalsContext = createContext<(playerId: string) => MonopolyAnimal | null>(() => null);

interface EffigyProps {
  /** Engine player id; picks the seat colour and, through the context, the animal. */
  id?: string;
  /** Shown when there's no animal yet, and as the tooltip. */
  name: string;
  animal?: MonopolyAnimal | null;
  color?: string;
  className?: string;
}

/** A player's token: their 3D animal standing on a disc in their seat colour. */
export function Effigy({ id, name, animal, color, className }: EffigyProps) {
  const lookup = useContext(AnimalsContext);
  const pick = animal ?? (id ? lookup(id) : null);
  const seat = color ?? (id ? tokenColor(id) : "#5f5f5b");
  return (
    <i className={["effigy", className].filter(Boolean).join(" ")} style={{ "--seat": seat } as React.CSSProperties} title={name}>
      {pick ? <img src={animalSrc(pick)} alt="" draggable={false} /> : <span className="effigy-letter">{name[0] ?? "?"}</span>}
    </i>
  );
}

/** A row of animals to choose from; ones other players hold are greyed out. */
export function AnimalPicker({ value, onChange, taken = new Set() }: { value: MonopolyAnimal | null; onChange: (a: MonopolyAnimal) => void; taken?: ReadonlySet<string> }) {
  return (
    <div className="animal-picker" role="radiogroup" aria-label="Your animal">
      {MONOPOLY_ANIMALS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          aria-label={animalLabel(a)}
          title={taken.has(a) ? `${animalLabel(a)} (taken)` : animalLabel(a)}
          className={value === a ? "animal picked" : "animal"}
          disabled={taken.has(a)}
          onClick={() => onChange(a)}
        >
          <img src={animalSrc(a)} alt="" draggable={false} />
        </button>
      ))}
    </div>
  );
}
