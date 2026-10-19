
const {
  loadGraph,
  findByImplementedFile,
  getFeature,
  getRequirement,
} = require("./graph-load");

function resolveImpactFromFiles(changedFiles) {
  const graph = loadGraph();
  const out = {
    features: new Set(),
    requirements: new Set(),
    downstreamFeatures: new Set(),
    sharedContractsTouched: new Set(),
    unmappedFiles: [],
  };
  if (!graph) {
    return {
      features: [],
      requirements: [],
      downstreamFeatures: [],
      sharedContractsTouched: [],
      unmappedFiles: changedFiles.slice(),
    };
  }
  for (const file of changedFiles) {
    const norm = String(file).replace(/\\/g, "/");
    const hit = findByImplementedFile(norm);
    if (!hit.requirements.length && !hit.features.length) {
      out.unmappedFiles.push(norm);
      continue;
    }
    hit.requirements.forEach((r) => out.requirements.add(r));
    hit.features.forEach((f) => out.features.add(f));
  }
  for (const f of out.features) {
    const rec = getFeature(f);
    if (!rec) continue;
    for (const down of rec.usedBy || []) {
      if (!out.features.has(down)) out.downstreamFeatures.add(down);
    }
    for (const c of rec.sharedContractsTouched || []) {
      out.sharedContractsTouched.add(c);
    }
  }
  return {
    features: Array.from(out.features).sort(),
    requirements: Array.from(out.requirements).sort(),
    downstreamFeatures: Array.from(out.downstreamFeatures).sort(),
    sharedContractsTouched: Array.from(out.sharedContractsTouched).sort(),
    unmappedFiles: out.unmappedFiles,
  };
}

function resolveImpactFromRequirements(changedRequirements) {
  const graph = loadGraph();
  const out = {
    features: new Set(),
    requirements: new Set(changedRequirements),
    dependentRequirements: new Set(),
    downstreamFeatures: new Set(),
  };
  if (!graph) {
    return {
      features: [],
      requirements: Array.from(out.requirements).sort(),
      dependentRequirements: [],
      downstreamFeatures: [],
    };
  }
  for (const id of changedRequirements) {
    const r = graph.requirements[id];
    if (!r) continue;
    if (r.feature) out.features.add(r.feature);
  }
  for (const r of Object.values(graph.requirements)) {
    if (!r.dependsOn) continue;
    for (const dep of r.dependsOn) {
      if (changedRequirements.includes(dep)) {
        out.dependentRequirements.add(r.id);
        if (r.feature) out.features.add(r.feature);
      }
    }
  }
  for (const f of out.features) {
    const rec = graph.features[f];
    if (rec && rec.usedBy) {
      for (const down of rec.usedBy) out.downstreamFeatures.add(down);
    }
  }
  return {
    features: Array.from(out.features).sort(),
    requirements: Array.from(out.requirements).sort(),
    dependentRequirements: Array.from(out.dependentRequirements).sort(),
    downstreamFeatures: Array.from(out.downstreamFeatures).sort(),
  };
}

module.exports = {
  resolveImpactFromFiles,
  resolveImpactFromRequirements,
};
