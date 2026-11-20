const aliasesByUsername = new Map([
  ['sheila', 'mother@grocery.example.com'],
  ['shanmi', 'daughter@grocery.example.com'],
  ['shannen', 'sibling1@grocery.example.com'],
  ['drexel', 'sibling2@grocery.example.com'],
]);

const usernamesByAlias = new Map(
  Array.from(aliasesByUsername, ([username, alias]) => [alias, username])
);

export function toLoginAlias(username) {
  return aliasesByUsername.get(username.trim().toLowerCase()) ?? null;
}

export function fromLoginAlias(alias) {
  return usernamesByAlias.get(alias?.toLowerCase()) ?? null;
}
