window.MOEAZI_RESEARCH = { groups: [] };
(function (research) {
  const ranks = { recommended: 'Recommended', 'runner-up': 'Runner-up', other: 'Other option' };
  research.criteria = ['Data correctness / replay', 'Integration effort', 'Operational footprint', 'Relevant capability', 'Maintenance evidence', 'License'];
  research.pinned = (repo, revision, path) => 'https://github.com/' + repo + '/blob/' + revision + '/' + path;
  research.tree = (repo, revision) => 'https://github.com/' + repo + '/tree/' + revision;
  research.docs = url => url;
  research.addGroup = raw => {
    const options = raw.options.map(option => {
      const repoUrl = option.repoUrl || (option.local ? (option.sources && option.sources[0] ? option.sources[0][1] : '../../LOCAL_STACK.md') : research.tree(option.repo, option.revision));
      const sources = option.sources || [];
      const graph = (nodes, edges, label) => {
        if (!nodes) return null;
        const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const cooked = nodes.map(node => ({ ...node, id: node.id || slug(node.label), sources: node.path ? [[node.sourceLabel || (option.local ? 'Local source: ' : 'Pinned source: ') + node.path, option.local ? node.path : research.pinned(option.repo, option.revision, node.path)]] : node.sources || [] }));
        const refs = new Map(cooked.flatMap(node => [[node.id, node.id], [node.label, node.id]]));
        const links = (edges || []).map(edge => {
          const from = refs.get(edge.from), to = refs.get(edge.to);
          if (!from || !to) throw new Error('Invalid ' + label + ' graph edge for ' + option.name + ': ' + edge.from + ' → ' + edge.to);
          return { ...edge, from, to };
        });
        return { nodes: cooked, edges: links };
      };
      const graphs = option.internalGraph || option.moeaziGraph ? {
        internal: option.internalGraph ? { title: 'Internal component structure', summary: option.internalSummary, ...graph(option.internalGraph, option.internalEdges, 'internal') } : null,
        moeazi: option.moeaziGraph ? { title: 'Proposed connection to Moeazi', summary: option.moeaziSummary, ...graph(option.moeaziGraph, option.moeaziEdges, 'Moeazi') } : null,
      } : null;
      const matrix = Array.isArray(option.matrix) ? Object.fromEntries((raw.criteria || research.criteria).map((criterion, index) => [criterion, option.matrix[index]])) : (option.matrix || {});
      return { ...option, matrix, rankLabel: ranks[option.rank], repoUrl, sources: [...sources, ...(option.codePath ? [[(option.local ? 'Local code: ' : 'Pinned code: ') + option.codePath, option.local ? option.codePath : research.pinned(option.repo, option.revision, option.codePath)]] : []), ...(option.docsUrl ? [['Official documentation', option.docsUrl]] : [])], graphs };
    });
    research.groups.push({ ...raw, criteria: raw.criteria || research.criteria, options });
  };
})(window.MOEAZI_RESEARCH);
