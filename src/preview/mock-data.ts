import type { RenderedTweet } from "../lib/types";

// Tweets reais puxados da Lista (2060061882795372597). As replies foram
// geradas seguindo o SKILL.md (atuando como a skill), so pra preview da UI.
export const MOCK_RENDERED: RenderedTweet[] = [
  {
    tweet: {
      tweet_id: "2053296649871790104",
      handle: "berlatigonzalo",
      text: "the world is not ending, just transforming! (again and again…)",
      lang: "en",
      timestamp: "2026-05-28T08:00:00Z",
      isv: 86.68,
      inferred_layer: 3,
      is_poi: 0,
      context:
        "quoting @geohotarchive: 'The Real Singularity is the Friends We Made Along the Way'",
      url: "https://x.com/BerlatiGonzalo/status/2053296649871790104",
    },
    result: {
      tweet_id: "2053296649871790104",
      handle: "berlatigonzalo",
      isv: 86.68,
      inferred_layer: 3,
      is_poi: 0,
      pattern: 7,
      pattern_label: "aforismo / observacao seca",
      replies: [
        {
          text: "every doom cycle i've sat through (y2k, peak oil, the crypto winter) the world didn't end, it just rerouted. the people who panicked exited at the bottom, the ones who kept shipping owned the next phase",
          category: "caso_concreto",
        },
        {
          text: "there's a name for what you're pointing at, antifragility. the system doesn't just survive each transform, it needs the shocks to keep reorganizing",
          category: "nomear_fenomeno",
        },
        {
          text: "curious which transform felt most like an actual ending while you were inside it. the ones that genuinely scare people in real time usually turn out to be the interesting ones",
          category: "pergunta_especialista",
        },
      ],
    },
  },
  {
    tweet: {
      tweet_id: "2054926255640694883",
      handle: "m_i_yatsenko",
      text: "Massive for Centrifuge's assets.\nInstant redemption within a $1B facility that makes JTRSY one of the most liquid Treasury funds in the world.",
      lang: "en",
      timestamp: "2026-05-28T02:00:00Z",
      isv: 81.44,
      inferred_layer: 1,
      is_poi: 1,
      context:
        "quoting @centrifuge: 'Instant redemption for Centrifuge's tokenized assets, in partnership with @grovedotfinance.'",
      url: "https://x.com/m_i_yatsenko/status/2054926255640694883",
    },
    result: {
      tweet_id: "2054926255640694883",
      handle: "m_i_yatsenko",
      isv: 81.44,
      inferred_layer: 1,
      is_poi: 1,
      pattern: 6,
      pattern_label: "compartilha dado / metrica",
      replies: [
        {
          text: "instant redemption is the part most people gloss over. what's backing the instant leg under stress, a standing liquidity buffer or a market maker facility? that's the whole risk question",
          category: "pergunta_especialista",
        },
        {
          text: "what you're describing has a name in tradfi, liquidity transformation. pulling it off at $1b onchain without a bank balance sheet behind it is the genuinely hard part",
          category: "nomear_fenomeno",
        },
        {
          text: "money market funds hit this exact wall in 2008 when redemptions outran the liquidity of the underlying. curious how the onchain version holds up if everyone hits redeem on the same day",
          category: "cross_pollination",
        },
      ],
    },
  },
  {
    tweet: {
      tweet_id: "2056021717315674562",
      handle: "joeribillast",
      text: "13 minutes on a @TEDx stage.\n\nOne realization I could not stop thinking about:\n\nAI is making competence look cheap.\n\nAnd I think most companies still underestimate what that changes.",
      lang: "en",
      timestamp: "2026-05-28T14:00:00Z",
      isv: 45.35,
      inferred_layer: 1,
      is_poi: 1,
      context: null,
      url: "https://x.com/joeribillast/status/2056021717315674562",
    },
    result: {
      tweet_id: "2056021717315674562",
      handle: "joeribillast",
      isv: 45.35,
      inferred_layer: 1,
      is_poi: 1,
      pattern: 2,
      pattern_label: "opiniao declarativa",
      replies: [
        {
          text: "seeing this in hiring right now. a clean portfolio or a tidy PR used to signal competence, today it mostly signals access to good tooling. the screen that used to filter people barely filters anymore",
          category: "experiencia_builder",
        },
        {
          text: "when competence gets cheap the expensive thing becomes judgment, knowing which competent-looking output is actually right. the bottleneck just moves up a layer",
          category: "nomear_fenomeno",
        },
      ],
    },
  },
];
