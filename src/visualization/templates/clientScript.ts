/**
 * Client-side JavaScript for the pipeline visualization HTML output.
 * This is exported as a string to be inlined into the generated HTML.
 *
 * Placeholders:
 * - __NEEDS_DATA__ - replaced with JSON mapping job names to their dependencies
 * - __DEPENDENCY_DATA__ - replaced with JSON mapping job names to jobs that depend on them
 */
export const pipelineClientScript = `
// Dependency data injected by the generator
// These placeholders are replaced at generation time
const needsData = __NEEDS_DATA__;
const dependencyData = __DEPENDENCY_DATA__;

// Toggle individual job expansion
document.querySelectorAll('.job').forEach(job => {
  job.addEventListener('click', function(e) {
    // Don't toggle if clicking on the pre element (allow text selection)
    if (e.target.tagName === 'PRE') return;
    this.classList.toggle('expanded');
  });
});

// Toggle skipped jobs visibility
document.getElementById('toggleSkipped').addEventListener('change', function() {
  const skippedJobs = document.querySelectorAll('.job.skipped');
  skippedJobs.forEach(job => {
    job.style.display = this.checked ? 'block' : 'none';
  });
  // Redraw arrows when visibility changes
  if (document.getElementById('toggleArrows').checked) {
    drawArrows();
  }
});

// Expand/collapse all jobs
document.getElementById('expandAll').addEventListener('change', function() {
  const jobs = document.querySelectorAll('.job');
  jobs.forEach(job => {
    if (this.checked) {
      job.classList.add('expanded');
    } else {
      job.classList.remove('expanded');
    }
  });
  // Redraw arrows when layout changes
  if (document.getElementById('toggleArrows').checked) {
    setTimeout(drawArrows, 100);
  }
});

// Toggle dependency badges in jobs
document.getElementById('toggleNeeds').addEventListener('change', function() {
  const needsContainers = document.querySelectorAll('.job-needs');
  needsContainers.forEach(container => {
    if (this.checked) {
      container.classList.add('visible');
    } else {
      container.classList.remove('visible');
    }
  });
});

// Toggle dependency arrows
document.getElementById('toggleArrows').addEventListener('change', function() {
  const container = document.getElementById('arrowsContainer');
  if (this.checked) {
    container.style.display = 'block';
    drawArrows();
  } else {
    container.style.display = 'none';
  }
});

// Draw dependency arrows
function drawArrows() {
  const svg = document.getElementById('arrowsSvg');
  const wrapper = document.querySelector('.pipeline-wrapper');
  const wrapperRect = wrapper.getBoundingClientRect();

  // Clear existing arrows (except defs)
  const existingPaths = svg.querySelectorAll('path');
  existingPaths.forEach(p => p.remove());

  // Get all visible job elements
  const jobElements = {};
  document.querySelectorAll('.job').forEach(el => {
    if (el.offsetParent !== null) { // Check if visible
      const jobName = el.getAttribute('data-job-name');
      if (jobName) {
        jobElements[jobName] = el;
      }
    }
  });

  // Draw arrows for each dependency
  for (const [sourceJob, targetJobs] of Object.entries(dependencyData)) {
    const sourceEl = jobElements[sourceJob];
    if (!sourceEl) continue;

    for (const targetJob of targetJobs) {
      const targetEl = jobElements[targetJob];
      if (!targetEl) continue;

      // Get element positions relative to wrapper
      const sourceRect = sourceEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();

      // Calculate connection points
      const sourceX = sourceRect.right - wrapperRect.left;
      const sourceY = sourceRect.top + sourceRect.height / 2 - wrapperRect.top;
      const targetX = targetRect.left - wrapperRect.left;
      const targetY = targetRect.top + targetRect.height / 2 - wrapperRect.top;

      // Create curved path
      const midX = (sourceX + targetX) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

      // Use bezier curve for smooth connection
      const d = \`M \${sourceX} \${sourceY} C \${midX} \${sourceY}, \${midX} \${targetY}, \${targetX} \${targetY}\`;
      path.setAttribute('d', d);
      path.setAttribute('class', 'dependency-arrow');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      path.setAttribute('data-source', sourceJob);
      path.setAttribute('data-target', targetJob);

      svg.appendChild(path);
    }
  }

  // Update SVG size to match wrapper
  svg.style.width = wrapper.scrollWidth + 'px';
  svg.style.height = wrapper.scrollHeight + 'px';
}

// Redraw arrows on window resize
let resizeTimeout;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(function() {
    if (document.getElementById('toggleArrows').checked) {
      drawArrows();
    }
  }, 100);
});

// Redraw arrows on scroll (for horizontal scrolling)
document.querySelector('.pipeline').addEventListener('scroll', function() {
  if (document.getElementById('toggleArrows').checked) {
    drawArrows();
  }
});
`
