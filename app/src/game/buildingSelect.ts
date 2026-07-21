import type { Atlas } from "../core/atlas";
import type { BuildingType } from "../entities/buildingTypes";
import { CardSelect } from "./cardSelect";

/** Card picker for which house type future lots build as - see
 * game/cardSelect.ts and entities/buildingTypes.ts. */
export class BuildingSelect extends CardSelect<BuildingType> {
  constructor(atlas: Atlas) {
    super(atlas.houseIcon, "次の建物を選べ！");
  }
}
