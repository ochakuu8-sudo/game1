import type { Atlas } from "../core/atlas";
import { CardSelect } from "./cardSelect";
import type { PowerUpChoice } from "./powerups";

/** Card picker for the run's power-up buffs - see game/cardSelect.ts. */
export class PowerUpSelect extends CardSelect<PowerUpChoice> {
  constructor(atlas: Atlas) {
    super("強化を選べ！", () => atlas.star, (choice) => choice.color);
  }
}
