import { useTranslation } from "../i18n";
import { projectTemplates } from "../lib/templates";
import type { Project } from "../lib/tauri";

const categoryKeys = {
  starter: "templates.category.starter",
  music: "templates.category.music",
  rhythm: "templates.category.rhythm",
  electronic: "templates.category.electronic",
  sfx: "templates.category.sfx",
} as const;

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onSelect: (project: Project) => void;
}

export function TemplateGallery({ open, onClose, onSelect }: TemplateGalleryProps) {
  const t = useTranslation();
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="template-gallery" role="dialog" aria-modal="true" aria-labelledby="template-gallery-title" onClick={(event) => event.stopPropagation()}>
        <div className="settings-heading">
          <div><span className="eyebrow">SONICFORGE / STARTERS</span><h2 id="template-gallery-title">{t("templates.title")}</h2></div>
          <button type="button" className="icon-button" aria-label={t("templates.close")} onClick={onClose}>×</button>
        </div>
        <p className="settings-copy">{t("templates.description")}</p>
        <div className="template-grid">
          {projectTemplates.map((template) => (
            <article className="template-card" key={template.id}>
              <span className="template-category">{t(categoryKeys[template.category])}</span>
              <h3>{t(template.titleKey)}</h3>
              <p>{t(template.descriptionKey)}</p>
              <button type="button" className="primary-button" onClick={() => onSelect(template.createProject())}>{t("templates.use")}</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
