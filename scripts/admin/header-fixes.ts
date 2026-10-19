import assert from 'node:assert/strict';
import ts from 'typescript';

type Edit = readonly [before: string, after: string];
/** Optional reviewed upstream fixes. The default migration remains a faithful baseline. */
const changes: Readonly<Record<string, readonly Edit[]>> = {
  'src/layouts/components/notifications-popover.tsx': [
    ["import { useState, useCallback } from 'react';", "import { useState, useCallback, useRef, useId } from 'react';"],
    ['  const [notifications, setNotifications] = useState(data);', '  const [notifications, setNotifications] = useState(data);\n  const titleRef = useRef<HTMLHeadingElement>(null);\n  const dialogId = useId();'],
    ['    setNotifications(updatedNotifications);', '    // Move focus before the read button is removed; do not schedule a delayed global focus change.\n    titleRef.current?.focus({ preventScroll: true });\n    setNotifications(updatedNotifications);'],
    ['      <IconButton\n        color=', '      <IconButton\n        aria-label="Notifications"\n        aria-haspopup="dialog"\n        aria-expanded={!!openPopover}\n        aria-controls={openPopover ? dialogId : undefined}\n        color='],
    ['          paper: {\n            sx:', '          paper: {\n            id: dialogId,\n            role: \'dialog\',\n            \'aria-modal\': true,\n            \'aria-labelledby\': `${dialogId}-title`,\n            sx:'],
    ['<Typography variant="subtitle1">Notifications</Typography>', '<Typography ref={titleRef} id={`${dialogId}-title`} component="h2" tabIndex={-1} variant="subtitle1">Notifications</Typography>'],
    ['<Typography variant="body2" sx={{ color: \'text.secondary\' }}>', '<Typography role="status" variant="body2" sx={{ color: \'text.secondary\' }}>'],
  ],
  'src/layouts/components/language-popover.tsx': [
    ["import { useState, useCallback } from 'react';", "import { useState, useCallback, useId } from 'react';"],
    ['  const { open, anchorEl, onClose, onOpen } = usePopover();', '  const { open, anchorEl, onClose, onOpen } = usePopover();\n  const menuId = useId();'],
    ['      <MenuList\n        sx=', '      <MenuList\n        id={menuId}\n        aria-labelledby={`${menuId}-trigger`}\n        autoFocusItem={open}\n        sx='],
    ['        aria-label="Languages button"', '        id={`${menuId}-trigger`}\n        aria-label="Languages button"\n        aria-haspopup="menu"\n        aria-expanded={open}\n        aria-controls={open ? menuId : undefined}'],
  ],
  'src/layouts/components/workspaces-popover.tsx': [
    ["import { useState, useCallback } from 'react';", "import { useState, useCallback, useId } from 'react';"],
    ['  const [workspace, setWorkspace] = useState(data[0]);', '  const [workspace, setWorkspace] = useState(data[0]);\n  const menuId = useId();'],
    ['      <ButtonBase\n        disableRipple', '      <ButtonBase\n        id={`${menuId}-trigger`}\n        aria-haspopup="menu"\n        aria-expanded={!!openPopover}\n        aria-controls={openPopover ? menuId : undefined}\n        disableRipple'],
    ['        <MenuList\n          disablePadding', '        <MenuList\n          id={menuId}\n          aria-labelledby={`${menuId}-trigger`}\n          autoFocusItem={!!openPopover}\n          disablePadding'],
  ],
  'src/layouts/components/account-popover.tsx': [
    ["import { useState, useCallback } from 'react';", "import { useState, useCallback, useId } from 'react';"],
    ['  const router = useRouter();', '  const router = useRouter();\n  const menuId = useId();'],
    ['      <IconButton\n        onClick=', '      <IconButton\n        id={`${menuId}-trigger`}\n        aria-label="Account"\n        aria-haspopup="menu"\n        aria-expanded={!!openPopover}\n        aria-controls={openPopover ? menuId : undefined}\n        onClick='],
    ['        <MenuList\n          disablePadding', '        <MenuList\n          id={menuId}\n          aria-labelledby={`${menuId}-trigger`}\n          autoFocusItem={!!openPopover}\n          disablePadding'],
  ],
  'src/layouts/components/menu-button.tsx': [
    ['    <IconButton sx={sx} {...other}>', '    <IconButton aria-label="Open navigation" sx={sx} {...other}>'],
  ],
  'src/layouts/dashboard/nav.tsx': [
    ['      open={open}\n      onClose={onClose}', '      open={open}\n      onClose={onClose}\n      slotProps={{ paper: { role: \'dialog\', \'aria-modal\': true, \'aria-label\': \'Navigation\' } }}'],
    ['                    href={item.path}', '                    href={item.path}\n                    aria-current={isActived ? \'page\' : undefined}'],
  ],
  'src/layouts/components/searchbar.tsx': [
    ["import { useState, useCallback } from 'react';", "import { useState, useCallback, useRef } from 'react';"],
    ['  const [open, setOpen] = useState(false);', '  const [open, setOpen] = useState(false);\n  const triggerRef = useRef<HTMLButtonElement>(null);\n  const restoreFocus = useRef(false);'],
    ['    setOpen((prev) => !prev);', '    restoreFocus.current = false;\n    setOpen((prev) => !prev);'],
    ['  const handleClose = useCallback(() => {\n    setOpen(false);\n  }, []);', '  const handleClose = useCallback((restore = false) => {\n    restoreFocus.current = restore;\n    setOpen(false);\n  }, []);'],
    ['    <ClickAwayListener onClickAway={handleClose}>', '    <ClickAwayListener onClickAway={() => handleClose(false)}>'],
    ['          <IconButton onClick={handleOpen}>', '          <IconButton ref={triggerRef} aria-label="Open search" onClick={handleOpen}>'],
    ['        <Slide direction="down" in={open} mountOnEnter unmountOnExit>', '        <Slide direction="down" in={open} mountOnEnter unmountOnExit onExited={() => {\n          if (restoreFocus.current) triggerRef.current?.focus({ preventScroll: true });\n          restoreFocus.current = false;\n        }}>'],
    ['          <Box\n            sx=', '          <Box\n            component="form"\n            role="search"\n            onSubmit={(event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); handleClose(true); }}\n            onKeyDown={(event: React.KeyboardEvent<HTMLFormElement>) => { if (event.key === \'Escape\') { event.preventDefault(); handleClose(true); } }}\n            sx='],
    ['              placeholder="Search…"', '              placeholder="Search…"\n              inputProps={{ \'aria-label\': \'Search\' }}'],
    ['            <Button variant="contained" onClick={handleClose}>', '            <Button type="submit" variant="contained">'],
  ],
};
export const headerFixPaths = Object.freeze(Object.keys(changes));
export function applyHeaderFixes(path: string, source: string): { code: string; edits: number } {
  const edits = changes[path]; if (!edits) return { code: source, edits: 0 };
  let code = source;
  for (const [before, after] of edits) {
    assert.equal(code.split(before).length, 2, `Header fix requires one reviewed anchor in ${path}: ${before.slice(0, 70)}`);
    code = code.replace(before, after);
  }
  const result = ts.transpileModule(code, { fileName: path, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } });
  assert.equal(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length ?? 0, 0, 'Invalid header adaptation');
  return { code, edits: edits.length };
}
