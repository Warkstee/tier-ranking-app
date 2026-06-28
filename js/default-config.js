/**
 * Default configuration JSON used when no config file is available.
 * @type {string}
 */
export const DEFAULT_CONFIG = `{
  "title": "S-Tier Ranking Board",
  "tiers": ["S", "A", "B", "C", "D", "F"],
  "min": 0,
  "max": 10,
  "rubric": [
    {
      "id": "first_impression",
      "name": "First impression",
      "weight": 1.0
    },
    {
      "id": "core_features",
      "name": "Core features",
      "weight": 1.2
    },
    {
      "id": "ease",
      "name": "Ease of use",
      "weight": 1.1
    },
    {
      "id": "performance",
      "name": "Performance",
      "weight": 1.2
    },
    {
      "id": "reliability",
      "name": "Reliability",
      "weight": 1.2
    },
    {
      "id": "polish",
      "name": "Visual polish",
      "weight": 1.0
    },
    {
      "id": "flexibility",
      "name": "Flexibility",
      "weight": 0.9
    },
    {
      "id": "learning_curve",
      "name": "Learning curve",
      "weight": 0.8
    },
    {
      "id": "workflow_fit",
      "name": "Workflow fit",
      "weight": 1.0
    },
    {
      "id": "final_vibe",
      "name": "Final vibe",
      "weight": 0.9
    }
  ],
  "candidates": [
    {
      "name": "Atlas",
      "image": "./assets/candidates/atlas.svg",
      "description": "A polished all-rounder with strong defaults and broad appeal.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 9,
        "core_features": 9,
        "ease": 8,
        "performance": 8,
        "reliability": 9,
        "polish": 8,
        "flexibility": 8,
        "learning_curve": 7,
        "workflow_fit": 9,
        "final_vibe": 8
      }
    },
    {
      "name": "Beacon",
      "image": "./assets/candidates/beacon.svg",
      "description": "A friendly pick that looks refined and gets new users moving quickly.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 8,
        "core_features": 7,
        "ease": 9,
        "performance": 7,
        "reliability": 8,
        "polish": 9,
        "flexibility": 7,
        "learning_curve": 8,
        "workflow_fit": 8,
        "final_vibe": 8
      }
    },
    {
      "name": "Comet",
      "image": "./assets/candidates/comet.svg",
      "description": "A fast, focused option with confident day-to-day performance.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 7,
        "core_features": 8,
        "ease": 8,
        "performance": 9,
        "reliability": 8,
        "polish": 7,
        "flexibility": 8,
        "learning_curve": 7,
        "workflow_fit": 8,
        "final_vibe": 7
      }
    },
    {
      "name": "Drift",
      "image": "./assets/candidates/drift.svg",
      "description": "A flexible contender that rewards setup time and deeper customization.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 6,
        "core_features": 7,
        "ease": 7,
        "performance": 8,
        "reliability": 7,
        "polish": 6,
        "flexibility": 8,
        "learning_curve": 6,
        "workflow_fit": 7,
        "final_vibe": 6
      }
    },
    {
      "name": "Ember",
      "image": "./assets/candidates/ember.svg",
      "description": "A stylish candidate with a memorable first impression and a few tradeoffs.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 9,
        "core_features": 8,
        "ease": 7,
        "performance": 7,
        "reliability": 7,
        "polish": 9,
        "flexibility": 6,
        "learning_curve": 8,
        "workflow_fit": 7,
        "final_vibe": 9
      }
    },
    {
      "name": "Flux",
      "image": "./assets/candidates/flux.svg",
      "description": "A power-user option with unusual flexibility but a steeper learning curve.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 5,
        "core_features": 6,
        "ease": 6,
        "performance": 7,
        "reliability": 6,
        "polish": 7,
        "flexibility": 9,
        "learning_curve": 5,
        "workflow_fit": 6,
        "final_vibe": 6
      }
    },
    {
      "name": "Grove",
      "image": "./assets/candidates/grove.svg",
      "description": "A calm, reliable choice that feels balanced across most categories.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 8,
        "core_features": 8,
        "ease": 8,
        "performance": 7,
        "reliability": 7,
        "polish": 8,
        "flexibility": 7,
        "learning_curve": 7,
        "workflow_fit": 8,
        "final_vibe": 7
      }
    },
    {
      "name": "Halo",
      "image": "./assets/candidates/halo.svg",
      "description": "A visually pleasant option that is easy to explain on camera.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 6,
        "core_features": 6,
        "ease": 7,
        "performance": 6,
        "reliability": 7,
        "polish": 8,
        "flexibility": 6,
        "learning_curve": 8,
        "workflow_fit": 6,
        "final_vibe": 7
      }
    },
    {
      "name": "Ion",
      "image": "./assets/candidates/ion.svg",
      "description": "A compact option that performs well once its workflow clicks.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 7,
        "core_features": 6,
        "ease": 7,
        "performance": 8,
        "reliability": 8,
        "polish": 6,
        "flexibility": 8,
        "learning_curve": 6,
        "workflow_fit": 7,
        "final_vibe": 6
      }
    },
    {
      "name": "Juniper",
      "image": "./assets/candidates/juniper.svg",
      "description": "A budget-feeling pick that can still surprise in the right niche.",
      "tier": "Unranked",
      "scores": {
        "first_impression": 5,
        "core_features": 5,
        "ease": 6,
        "performance": 6,
        "reliability": 5,
        "polish": 6,
        "flexibility": 6,
        "learning_curve": 7,
        "workflow_fit": 5,
        "final_vibe": 6
      }
    }
  ]
}`;
