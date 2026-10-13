export function createTaskEditor(container, { create, complete, saved, report, parent }) {
  const blank = (depth = 0) => ({ text: '', depth, checked: false, item: false });
  let rows = [blank()], saving = false;
  container.innerHTML = '<div class="task-draft" role="group" aria-label="Bulk task editor"></div><div class="task-draft-actions"><span id="task-draft-help">Enter: next task · Tab / Shift+Tab: indent / outdent · paste a Markdown list · ⌘/Ctrl+Enter: save</span><button type="button" class="primary">Add tasks</button></div><p class="task-draft-status" role="status"></p>';
  const list = container.querySelector('.task-draft'), button = container.querySelector('button'), status = container.querySelector('[role=status]');
  const resize = field => { field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px`; };
  function focus(index = rows.length - 1, position, end = position) {
    const field = list.children[index]?.querySelector('textarea');
    if (!field) return;
    field.focus(); field.setSelectionRange(position ?? field.value.length, end ?? field.value.length);
    field.scrollIntoView({ block: 'nearest' });
  }
  const subtreeEnd = i => { let end = i + 1; while (end < rows.length && rows[end].depth > rows[i].depth) end++; return end; };
  function indent(i, depth) {
    const end = subtreeEnd(i), delta = depth - rows[i].depth;
    for (let j = i; j < end; j++) rows[j].depth += delta;
  }
  function render(index, position, end = position) {
    list.replaceChildren(...rows.map((row, i) => {
      const line = document.createElement('div'); line.className = 'task-draft-row'; line.style.paddingLeft = `${row.depth * 24}px`;
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.checked; check.disabled = saving || Boolean(row.id); check.setAttribute('aria-label', `Complete task ${i + 1}`); check.hidden = !row.item;
      const field = document.createElement('textarea'); field.rows = 1; field.value = row.text; field.readOnly = saving || Boolean(row.id); field.setAttribute('aria-label', `Task ${i + 1}`); field.setAttribute('aria-describedby', 'task-draft-help'); field.placeholder = i ? 'Next task…' : 'Write tasks, one per line…';
      field.addEventListener('input', () => { row.text = field.value; resize(field); });
      check.addEventListener('change', () => { row.checked = check.checked; });
      field.addEventListener('keydown', e => {
        if (saving || row.id || e.isComposing) return;
        const start = field.selectionStart, end = field.selectionEnd;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); return; }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          if (!row.text && row.depth) { indent(i, row.depth - 1); render(i, 0); return; }
          row.text = field.value.slice(0, start); row.item = Boolean(row.text.trim());
          const next = start === field.value.length ? subtreeEnd(i) : i + 1;
          rows.splice(next, 0, { ...blank(row.depth), text: field.value.slice(end) }); render(next, 0);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const depth = e.shiftKey ? Math.max(0, row.depth - 1) : Math.min(row.depth + 1, i ? rows[i - 1].depth + 1 : 0);
          indent(i, depth); render(i, start, end);
        } else if (e.key === 'Backspace' && start === 0 && end === 0 && i && !rows[i - 1].id) {
          e.preventDefault();
          if (row.depth) { indent(i, row.depth - 1); render(i, 0); return; }
          const previous = rows[i - 1], caret = previous.text.length;
          indent(i, previous.depth); previous.text += row.text; rows.splice(i, 1); render(i - 1, caret);
        } else if (e.key === 'ArrowUp' && start === 0 && end === 0 && i) { e.preventDefault(); focus(i - 1); }
        else if (e.key === 'ArrowDown' && start === row.text.length && end === start && i < rows.length - 1) { e.preventDefault(); focus(i + 1, 0); }
        else if (e.key === 'Escape') { field.blur(); }
      });
      field.addEventListener('paste', e => {
        if (saving || row.id) return;
        const text = e.clipboardData.getData('text/plain');
        if (!text.includes('\n') && !/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(text)) return;
        e.preventDefault();
        const lines = text.replace(/\r/g, '').split('\n').filter((s, n, a) => s.trim() || n === a.length - 1);
        const parsed = lines.map(text => {
          const match = text.match(/^(\s*)(?:(?:[-*+]|\d+[.)])\s+)?(?:\[([ xX])\]\s*)?(.*)$/);
          return { text: match[3], depth: match[1].replace(/\t/g, '    ').length, checked: /x/i.test(match[2] || ''), item: Boolean(match[3].trim()) };
        });
        const levels = [parsed[0].depth];
        for (const r of parsed) {
          while (levels.length > 1 && r.depth < levels.at(-1)) levels.pop();
          if (r.depth > levels.at(-1)) levels.push(r.depth);
          r.depth = row.depth + levels.length - 1;
        }
        const prefix = field.value.slice(0, field.selectionStart), suffix = field.value.slice(field.selectionEnd);
        parsed[0].text = prefix + parsed[0].text;
        if (prefix) parsed[0].checked = row.checked;
        if (suffix && (!prefix || parsed.length === 1)) parsed.at(-1).checked = row.checked;
        const caret = parsed.at(-1).text.length;
        parsed.at(-1).text += suffix;
        const descendants = rows.splice(i + 1, subtreeEnd(i) - i - 1);
        let firstEnd = 1; while (firstEnd < parsed.length && parsed[firstEnd].depth > row.depth) firstEnd++;
        const last = parsed.at(-1); parsed.splice(firstEnd, 0, ...descendants);
        rows.splice(i, 1, ...parsed); render(rows.indexOf(last), caret);
      });
      line.append(check, field); return line;
    }));
    for (const field of list.querySelectorAll('textarea')) resize(field);
    button.disabled = saving; button.textContent = saving ? 'Adding tasks…' : 'Add tasks';
    if (index !== undefined) focus(index, position, end);
  }
  async function save() {
    if (saving || !rows.some(r => r.text.trim())) return;
    saving = true; render(); status.textContent = 'Saving tasks…';
    const parents = [], base = parent(); let count = 0;
    try {
      for (const row of rows) {
        if (!row.text.trim()) continue;
        const depth = Math.min(row.depth, parents.length);
        if (!row.id) row.id = (await create({ title: row.text.trim(), parent_id: depth ? parents[depth - 1] : base || null })).id;
        parents[depth] = row.id; parents.length = depth + 1;
        if (row.checked && !row.completed) { await complete(row.id); row.completed = true; }
        count++;
      }
      rows = [blank()]; status.textContent = `${count} tasks added.`;
      await saved(count);
    } catch (error) {
      status.textContent = `Could not finish saving: ${error.message}. Saved rows are locked; Add tasks resumes without duplicating them.`;
      report(error);
    } finally { saving = false; render(rows.findIndex(r => !r.id)); }
  }
  button.addEventListener('click', () => void save()); render();
  return { focus, save };
}
