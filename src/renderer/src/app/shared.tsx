/** The two layouts, as the Settings tiles present them. */
export const LAYOUTS = [
  {
    v: 'flow' as const,
    label: 'Flowchart',
    hint: 'Workflow as a node canvas; results as a drag-and-drop dashboard.'
  },
  {
    v: 'form' as const,
    label: 'Form',
    hint: 'Workflow as a list of steps, each with its settings and plots beside it.'
  }
]
/** The menu width (px) of a project row's actions. */
export const ROW_MENU_W = 200
