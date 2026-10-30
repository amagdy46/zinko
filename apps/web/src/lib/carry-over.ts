import { count } from "@/lib/format"

export interface CarryOver {
  acceptedRisks: number
  notes: number
  ownerOverrides: number
  leftOut: number
  detailed: boolean
}

/**
 * What a new audit takes over from its baseline, in words: "2 accepted risks, 3 notes, 1 finding
 * left out of the report". Empty when nothing carries; the caller says which audit it comes from.
 */
export const carryOverText = (carryOver: CarryOver) => {
  const parts = [
    carryOver.acceptedRisks > 0 && count(carryOver.acceptedRisks, "accepted risk"),
    carryOver.notes > 0 && count(carryOver.notes, "note"),
    carryOver.ownerOverrides > 0 && count(carryOver.ownerOverrides, "owner override"),
    carryOver.leftOut > 0 && `${count(carryOver.leftOut, "finding")} left out of the report`,
    carryOver.detailed && "the Detailed disclosure level",
  ].filter((part) => part !== false)
  return parts.join(", ")
}
