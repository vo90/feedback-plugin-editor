/* DOM-service boundary for the Hybrid Track feature.
 *
 * The body-mounted modal reuses the Editor's established escaping, choice
 * prompt, and focus-trap behavior. Keep those private integration details in
 * one feature-owned port instead of importing them throughout the UI.
 */

export {
    _editorEscHtml as escapeEditorMarkup,
    _editorPromptChoice as promptEditorChoice,
    _installModalKeyboard as installEditorModalKeyboard,
} from '../ui.js';
