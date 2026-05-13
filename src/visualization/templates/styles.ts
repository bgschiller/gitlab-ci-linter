/**
 * CSS styles for the pipeline visualization HTML output.
 * This is exported as a string to be inlined into the generated HTML.
 */
export const pipelineStyles = `
:root {
  --color-success: #108548;
  --color-success-bg: #c3e6cd;
  --color-manual: #1f75cb;
  --color-manual-bg: #cbe2f9;
  --color-always: #6e49cb;
  --color-always-bg: #e1d8f9;
  --color-skipped: #737373;
  --color-skipped-bg: #ececec;
  --color-stage-bg: #f0f0f0;
  --color-border: #dcdcdc;
  --color-text: #303030;
  --color-text-secondary: #666;
}

* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  margin: 0;
  padding: 20px;
  background: #fafafa;
  color: var(--color-text);
}

.header {
  text-align: center;
  margin-bottom: 30px;
}

.header h1 {
  margin: 0 0 10px 0;
  font-size: 24px;
  font-weight: 600;
}

.summary {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.summary-item {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
}

.summary-running {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.summary-skipped {
  background: var(--color-skipped-bg);
  color: var(--color-skipped);
}

.summary-total {
  background: #e8e8e8;
  color: var(--color-text);
}

.legend {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-bottom: 30px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.legend-dot.success { background: var(--color-success); }
.legend-dot.manual { background: var(--color-manual); }
.legend-dot.always { background: var(--color-always); }
.legend-dot.skipped { background: var(--color-skipped); }

.config-section {
  margin-bottom: 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--color-stage-bg);
  cursor: pointer;
  user-select: none;
}

.config-header:hover {
  background: #e5e5e5;
}

.config-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.config-toggle {
  font-size: 12px;
  color: var(--color-text-secondary);
  transition: transform 0.2s;
}

.config-section.expanded .config-toggle {
  transform: rotate(180deg);
}

.config-content {
  display: none;
  padding: 16px;
  background: #fafafa;
  max-height: 400px;
  overflow-y: auto;
}

.config-section.expanded .config-content {
  display: block;
}

.config-group {
  margin-bottom: 16px;
}

.config-group:last-child {
  margin-bottom: 0;
}

.config-group h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.config-group pre {
  margin: 0;
  padding: 12px;
  background: white;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
}

.config-group .changes-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.config-group .change-item {
  padding: 4px 8px;
  background: #e0f2fe;
  color: #0369a1;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
}

.pipeline {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 10px 0;
}

.stage {
  min-width: 220px;
  max-width: 300px;
  flex-shrink: 0;
}

.stage-header {
  background: var(--color-stage-bg);
  padding: 10px 14px;
  font-weight: 600;
  font-size: 14px;
  border-radius: 8px 8px 0 0;
  border: 1px solid var(--color-border);
  border-bottom: none;
}

.stage-jobs {
  background: white;
  border: 1px solid var(--color-border);
  border-radius: 0 0 8px 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 60px;
}

.job {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  position: relative;
}

.job:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.job.running {
  background: var(--color-success-bg);
  border-left: 3px solid var(--color-success);
}

.job.running.manual {
  background: var(--color-manual-bg);
  border-left-color: var(--color-manual);
}

.job.running.always {
  background: var(--color-always-bg);
  border-left-color: var(--color-always);
}

.job.skipped {
  background: var(--color-skipped-bg);
  border-left: 3px solid var(--color-skipped);
  opacity: 0.7;
}

.job-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.job-name {
  font-size: 13px;
  font-weight: 500;
  word-break: break-word;
}

.job-expand-icon {
  font-size: 10px;
  color: var(--color-text-secondary);
  transition: transform 0.2s;
}

.job.expanded .job-expand-icon {
  transform: rotate(180deg);
}

.job-when {
  font-size: 11px;
  margin-top: 4px;
  opacity: 0.8;
}

.job-details {
  display: none;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(0,0,0,0.1);
}

.job.expanded .job-details {
  display: block;
}

.job-details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.job-details h4 {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.job-details pre {
  margin: 0;
  padding: 10px;
  background: rgba(0,0,0,0.05);
  border-radius: 4px;
  overflow-x: auto;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
}

.job-details .reason {
  color: var(--color-skipped);
  font-style: italic;
  font-size: 12px;
  margin-bottom: 8px;
}

.controls {
  text-align: center;
  margin-bottom: 20px;
}

.controls label {
  cursor: pointer;
  user-select: none;
  margin: 0 10px;
}

.controls input[type="checkbox"] {
  margin-right: 6px;
}

/* Dependency arrows */
.arrows-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.arrows-container svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.dependency-arrow {
  fill: none;
  stroke: #6b7280;
  stroke-width: 1.5;
  opacity: 0.6;
  transition: opacity 0.2s, stroke 0.2s;
}

.dependency-arrow:hover {
  opacity: 1;
  stroke: #3b82f6;
  stroke-width: 2;
}

.arrow-marker {
  fill: #6b7280;
}

.pipeline-wrapper {
  position: relative;
}

.job.highlighted {
  box-shadow: 0 0 0 2px #3b82f6, 0 2px 8px rgba(59, 130, 246, 0.3);
}

.job .needs-badge {
  display: inline-block;
  background: #e0e7ff;
  color: #4338ca;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  margin-top: 4px;
  margin-right: 4px;
}

.job.skipped .needs-badge {
  background: #e5e5e5;
  color: #666;
}

.job-needs {
  display: none;
}

.job-needs.visible {
  display: block;
}

.needs-badge.missing {
  background: #fee2e2;
  color: #dc2626;
}

@media (max-width: 768px) {
  .pipeline {
    flex-direction: column;
  }

  .stage {
    max-width: 100%;
  }
}
`
