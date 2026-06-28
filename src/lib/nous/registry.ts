import { dynamicsAdapter } from './adapters/dynamics.ts'
import { hubspotAdapter } from './adapters/hubspot.ts'
import { salesforceAdapter } from './adapters/salesforce.ts'
import { vtigerAdapter } from './adapters/vtiger.ts'
import { webhookAdapter } from './adapters/webhook.ts'
import type { NousAdapter, NousIntegrationType } from './types.ts'

const ADAPTERS: Record<NousIntegrationType, NousAdapter> = {
  webhook: webhookAdapter,
  hubspot: hubspotAdapter,
  salesforce: salesforceAdapter,
  dynamics: dynamicsAdapter,
  vtiger: vtigerAdapter,
}

export function getNousAdapter(type: string): NousAdapter | null {
  if (type in ADAPTERS) return ADAPTERS[type as NousIntegrationType]
  return null
}

export function supportedIntegrationTypes(): NousIntegrationType[] {
  return Object.keys(ADAPTERS) as NousIntegrationType[]
}
