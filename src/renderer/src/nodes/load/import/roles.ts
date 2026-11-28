/** The column roles' colours, labels and chips (Columns stage). */
import type { InteractiveRole } from '../../../engine'

/** One colour per assignable column role — shared by the chips, header tints, and labels. */
export const ROLE_COLORS: Partial<Record<InteractiveRole, string>> = {
  id: '#e15759',
  sample: '#4e79a7',
  label: '#59a14f',
  meta: '#c99700',
  filter: '#8a5cf6'
}
/** Display names for the assignable roles (Ignore is the unassigned default — it has no chip). */
export const ROLE_LABEL: Partial<Record<InteractiveRole, string>> = {
  id: 'ID',
  sample: 'Sample',
  label: 'Name',
  meta: 'Metadata',
  filter: 'Filter'
}
export const ROLE_CHIPS: InteractiveRole[] = ['id', 'label', 'meta', 'filter', 'sample']
