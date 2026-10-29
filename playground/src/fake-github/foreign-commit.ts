/**
 * Helper to push a foreign commit onto FakeGithubServer (P2.9 conflict seams).
 * Uses server.handle() directly so it honors FakeGithubServer CAS and git-data rules.
 */
import { encodeBase64, encodeUtf8, type FakeGithubServer } from "@mycms/core"

export interface PushForeignEntryCommitInput {
  readonly server: FakeGithubServer
  readonly branch: string
  readonly path: string
  readonly mutator: (current: Record<string, unknown>) => Record<string, unknown>
  readonly message?: string
}

export async function pushForeignEntryCommit(input: PushForeignEntryCommitInput): Promise<string> {
  const { server, branch, path, mutator, message = "foreign (concurrent push)" } = input
  const headSha = server.ref(branch)
  if (!headSha) throw new Error(`branch ${branch} has no head`)
  const file = server.contents(branch, path)
  if (!file) throw new Error(`file ${path} not found on branch ${branch}`)
  const currentText = new TextDecoder().decode(file.bytes)
  const currentParsed = JSON.parse(currentText) as Record<string, unknown>
  const nextParsed = mutator(currentParsed)
  const nextText = `${JSON.stringify(nextParsed, null, 2)}\n`

  // 1. Create blob
  const blobRes = await server.handle({
    method: "POST",
    path: "/git/blobs",
    body: { content: encodeBase64(encodeUtf8(nextText)), encoding: "base64" },
  })
  const blobSha = (blobRes.json as { sha: string }).sha

  // 2. Read base tree of head
  const commitRes = await server.handle({ method: "GET", path: `/git/commits/${headSha}` })
  const baseTreeSha = (commitRes.json as { tree: { sha: string } }).tree.sha

  // 3. Create tree
  const treeRes = await server.handle({
    method: "POST",
    path: "/git/trees",
    body: {
      base_tree: baseTreeSha,
      tree: [{ path, mode: "100644", type: "blob", sha: blobSha }],
    },
  })
  const treeSha = (treeRes.json as { sha: string }).sha

  // 4. Create commit
  const newCommitRes = await server.handle({
    method: "POST",
    path: "/git/commits",
    body: {
      message,
      tree: treeSha,
      parents: [headSha],
    },
  })
  const newCommitSha = (newCommitRes.json as { sha: string }).sha

  // 5. Update ref
  await server.handle({
    method: "PATCH",
    path: `/git/refs/heads/${branch}`,
    body: { sha: newCommitSha, force: false },
  })

  return newCommitSha
}
