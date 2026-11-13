// Pane and hook environment: MTM_<NAME> first, TUIOS_<NAME> only as a fallback for old tuios panes.
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
export const mtmEnv = (source, name) => first(source?.[`MTM_${name}`], source?.[`TUIOS_${name}`]);
// SQL twin for stored hook values: json path names are both prefixes, MTM first.
export const mtmEnvSql = (valueOf, name) => `COALESCE(NULLIF(${valueOf('MTM_' + name)},''),${valueOf('TUIOS_' + name)})`;
