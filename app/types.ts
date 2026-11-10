export type Verdict = 'eligible' | 'review' | 'ineligible'
export type SupplyKind =
  | 'general_first'
  | 'general_second'
  | 'special_first_home'
  | 'special_newlywed'
  | 'special_multi_child'
  | 'special_newborn'
  | 'special_elderly_parent'
  | 'remaining'

export interface Profile {
  birth_year: number
  marital_status: 'single' | 'married'
  children: number
  household_size: number
  is_household_head: boolean
  homeless: boolean
  residence: { sido: string; sigungu: string; registered_since: string }
  account: {
    type: string
    rank_base_date: string
    total_deposit_krw: number | null
    deposit_count_estimate: number | null
    verified: boolean
  }
  income: { gross_annual_krw: number | null; basis_verified: boolean }
  assets: {
    financial_krw: number | null
    real_estate_krw: number | null
    car_value_krw: number | null
    verified: boolean
  }
}

export interface HousingType {
  name: string
  area_sqm: number | null
  households: number | null
  price_krw: number | null
}

export interface SupplyOption {
  id: string
  label: string
  kind: SupplyKind
  min_age?: number
  max_area_sqm?: number
  min_account_months?: number
  min_deposit_count?: number
  min_deposit_krw?: number
  requires_homeless?: boolean | null
  requires_household_head?: boolean
  residence_sido?: string
  residence_min_months?: number
  max_income_krw?: number
  max_assets_krw?: number
  requirements_complete: boolean
  source_ref: string
}

export interface Announcement {
  id: string
  notice_number: string
  name: string
  is_sample?: boolean
  region: { sido: string; sigungu: string; address: string }
  total_households: number | null
  housing_category: 'private' | 'national' | 'remaining' | 'unknown'
  announcement_date: string
  application_start: string | null
  application_end: string | null
  winner_date: string | null
  contract_start: string | null
  contract_end: string | null
  links: { official: string; homedubu: string }
  housing_types: HousingType[]
  supply_options: SupplyOption[]
  price_gain: {
    status: 'estimated' | 'unavailable'
    estimated_krw: number | null
    basis: string
    comparables: Array<{ name: string; month: string; area_sqm: number; price_krw: number }>
  }
  restrictions: { resale: string | null; residence: string | null }
}

export interface AnnouncementData {
  metadata: {
    generated_at: string
    source: string
    is_sample: boolean
    last_fetch_error: string | null
    count: number
  }
  announcements: Announcement[]
}

export interface Evaluation {
  option: SupplyOption
  housingType: HousingType
  verdict: Verdict
  reasons: string[]
  sourceRef: string
}

export interface AnnouncementEvaluation {
  verdict: Verdict
  best: Evaluation | null
  all: Evaluation[]
}
