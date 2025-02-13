import {
  AppBskyActorDefs,
  AppBskyEmbedExternal,
  AppBskyEmbedImages,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyFeedPost,
} from '../../client'
import { $Typed } from '../../client/util'
import { ModerationDecision } from '../decision'
import { hasMutedWord } from '../mutewords'
import { ModerationOpts, ModerationSubjectPost } from '../types'
import { decideAccount } from './account'
import { decideProfile } from './profile'

export function decidePost(
  subject: ModerationSubjectPost,
  opts: ModerationOpts,
): ModerationDecision {
  return ModerationDecision.merge(
    decideSubject(subject, opts),
    decideEmbed(subject.embed, opts)?.downgrade(),
    decideAccount(subject.author, opts),
    decideProfile(subject.author, opts),
  )
}

function decideSubject(
  subject: ModerationSubjectPost,
  opts: ModerationOpts,
): ModerationDecision {
  const acc = new ModerationDecision()

  acc.setDid(subject.author.did)
  acc.setIsMe(subject.author.did === opts.userDid)
  if (subject.labels?.length) {
    for (const label of subject.labels) {
      acc.addLabel('content', label, opts)
    }
  }
  acc.addHidden(checkHiddenPost(subject, opts.prefs.hiddenPosts))
  if (!acc.isMe) {
    acc.addMutedWord(checkMutedWords(subject, opts.prefs.mutedWords))
  }

  return acc
}

function decideEmbed(
  embed:
    | undefined
    | $Typed<AppBskyEmbedRecord.View>
    | $Typed<AppBskyEmbedRecordWithMedia.View>
    | { $type: string },
  opts: ModerationOpts,
) {
  if (embed) {
    if (
      (AppBskyEmbedRecord.isView(embed) ||
        AppBskyEmbedRecordWithMedia.isView(embed)) &&
      AppBskyEmbedRecord.isViewRecord(embed.record)
    ) {
      // quote post
      return decideQuotedPost(embed.record, opts)
    } else if (
      AppBskyEmbedRecordWithMedia.isView(embed) &&
      AppBskyEmbedRecord.isViewRecord(embed.record.record)
    ) {
      // quoted post with media
      return decideQuotedPost(embed.record.record, opts)
    } else if (
      (AppBskyEmbedRecord.isView(embed) ||
        AppBskyEmbedRecordWithMedia.isView(embed)) &&
      AppBskyEmbedRecord.isViewBlocked(embed.record)
    ) {
      // blocked quote post
      return decideBlockedQuotedPost(embed.record, opts)
    } else if (
      AppBskyEmbedRecordWithMedia.isView(embed) &&
      AppBskyEmbedRecord.isViewBlocked(embed.record.record)
    ) {
      // blocked quoted post with media
      return decideBlockedQuotedPost(embed.record.record, opts)
    }
  }

  return undefined
}

function decideQuotedPost(
  subject: AppBskyEmbedRecord.ViewRecord,
  opts: ModerationOpts,
) {
  const acc = new ModerationDecision()
  acc.setDid(subject.author.did)
  acc.setIsMe(subject.author.did === opts.userDid)
  if (subject.labels?.length) {
    for (const label of subject.labels) {
      acc.addLabel('content', label, opts)
    }
  }
  return ModerationDecision.merge(
    acc,
    decideAccount(subject.author, opts),
    decideProfile(subject.author, opts),
  )
}

function decideBlockedQuotedPost(
  subject: AppBskyEmbedRecord.ViewBlocked,
  opts: ModerationOpts,
) {
  const acc = new ModerationDecision()
  acc.setDid(subject.author.did)
  acc.setIsMe(subject.author.did === opts.userDid)
  if (subject.author.viewer?.muted) {
    if (subject.author.viewer?.mutedByList) {
      acc.addMutedByList(subject.author.viewer?.mutedByList)
    } else {
      acc.addMuted(subject.author.viewer?.muted)
    }
  }
  if (subject.author.viewer?.blocking) {
    if (subject.author.viewer?.blockingByList) {
      acc.addBlockingByList(subject.author.viewer?.blockingByList)
    } else {
      acc.addBlocking(subject.author.viewer?.blocking)
    }
  }
  acc.addBlockedBy(subject.author.viewer?.blockedBy)
  return acc
}

function checkHiddenPost(
  subject: ModerationSubjectPost,
  hiddenPosts: string[] | undefined,
) {
  if (!hiddenPosts?.length) {
    return false
  }
  if (hiddenPosts.includes(subject.uri)) {
    return true
  }
  if (subject.embed) {
    if (
      AppBskyEmbedRecord.isView(subject.embed) &&
      AppBskyEmbedRecord.isViewRecord(subject.embed.record) &&
      hiddenPosts.includes(subject.embed.record.uri)
    ) {
      return true
    }
    if (
      AppBskyEmbedRecordWithMedia.isView(subject.embed) &&
      AppBskyEmbedRecord.isViewRecord(subject.embed.record.record) &&
      hiddenPosts.includes(subject.embed.record.record.uri)
    ) {
      return true
    }
  }
  return false
}

function checkMutedWords(
  subject: ModerationSubjectPost,
  mutedWords: AppBskyActorDefs.MutedWord[] | undefined,
) {
  if (!mutedWords?.length) {
    return false
  }

  const postAuthor = subject.author

  if (AppBskyFeedPost.isRecord(subject.record)) {
    const post = subject.record as AppBskyFeedPost.Record
    // post text
    if (
      hasMutedWord({
        mutedWords,
        text: post.text,
        facets: post.facets,
        outlineTags: post.tags,
        languages: post.langs,
        actor: postAuthor,
      })
    ) {
      return true
    }

    if (post.embed && AppBskyEmbedImages.isMain(post.embed)) {
      // post images
      for (const image of post.embed.images) {
        if (
          hasMutedWord({
            mutedWords,
            text: image.alt,
            languages: post.langs,
            actor: postAuthor,
          })
        ) {
          return true
        }
      }
    }
  }

  const { embed } = subject
  if (embed) {
    // quote post
    if (
      (AppBskyEmbedRecord.isView(embed) ||
        AppBskyEmbedRecordWithMedia.isView(embed)) &&
      AppBskyEmbedRecord.isViewRecord(embed.record)
    ) {
      if (AppBskyFeedPost.isRecord(embed.record.value)) {
        const embeddedPost = embed.record.value as AppBskyFeedPost.Record
        const embedAuthor = embed.record.author

        // quoted post text
        if (
          hasMutedWord({
            mutedWords,
            text: embeddedPost.text,
            facets: embeddedPost.facets,
            outlineTags: embeddedPost.tags,
            languages: embeddedPost.langs,
            actor: embedAuthor,
          })
        ) {
          return true
        }

        // quoted post's images
        if (AppBskyEmbedImages.isMain(embeddedPost.embed)) {
          for (const image of embeddedPost.embed.images) {
            if (
              hasMutedWord({
                mutedWords,
                text: image.alt,
                languages: embeddedPost.langs,
                actor: embedAuthor,
              })
            ) {
              return true
            }
          }
        }

        // quoted post's link card
        if (AppBskyEmbedExternal.isMain(embeddedPost.embed)) {
          const { external } = embeddedPost.embed
          if (
            hasMutedWord({
              mutedWords,
              text: external.title + ' ' + external.description,
              languages: [],
              actor: embedAuthor,
            })
          ) {
            return true
          }
        }

        if (AppBskyEmbedRecordWithMedia.isMain(embeddedPost.embed)) {
          // quoted post's link card when it did a quote + media
          if (AppBskyEmbedExternal.isMain(embeddedPost.embed.media)) {
            const { external } = embeddedPost.embed.media
            if (
              hasMutedWord({
                mutedWords,
                text: external.title + ' ' + external.description,
                languages: [],
                actor: embedAuthor,
              })
            ) {
              return true
            }
          }

          // quoted post's images when it did a quote + media
          if (AppBskyEmbedImages.isMain(embeddedPost.embed.media)) {
            for (const image of embeddedPost.embed.media.images) {
              if (
                hasMutedWord({
                  mutedWords,
                  text: image.alt,
                  languages: AppBskyFeedPost.isRecord(embeddedPost.record)
                    ? embeddedPost.langs
                    : [],
                  actor: embedAuthor,
                })
              ) {
                return true
              }
            }
          }
        }
      }
    }
    // link card
    else if (AppBskyEmbedExternal.isView(embed)) {
      const { external } = embed
      if (
        hasMutedWord({
          mutedWords,
          text: external.title + ' ' + external.description,
          languages: [],
          actor: postAuthor,
        })
      ) {
        return true
      }
    }
    // quote post with media
    else if (
      AppBskyEmbedRecordWithMedia.isView(embed) &&
      AppBskyEmbedRecord.isViewRecord(embed.record.record)
    ) {
      const embedAuthor = embed.record.record.author

      // quoted post text
      if (AppBskyFeedPost.isRecord(embed.record.record.value)) {
        const post = embed.record.record.value as AppBskyFeedPost.Record
        if (
          hasMutedWord({
            mutedWords,
            text: post.text,
            facets: post.facets,
            outlineTags: post.tags,
            languages: post.langs,
            actor: embedAuthor,
          })
        ) {
          return true
        }
      }

      // quoted post images
      if (AppBskyEmbedImages.isView(embed.media)) {
        for (const image of embed.media.images) {
          if (
            hasMutedWord({
              mutedWords,
              text: image.alt,
              languages: AppBskyFeedPost.isRecord(subject.record)
                ? (subject.record as AppBskyFeedPost.Record).langs
                : [],
              actor: embedAuthor,
            })
          ) {
            return true
          }
        }
      }

      if (AppBskyEmbedExternal.isView(embed.media)) {
        const { external } = embed.media
        if (
          hasMutedWord({
            mutedWords,
            text: external.title + ' ' + external.description,
            languages: [],
            actor: embedAuthor,
          })
        ) {
          return true
        }
      }
    }
  }
  return false
}
