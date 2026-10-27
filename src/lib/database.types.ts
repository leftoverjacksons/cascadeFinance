
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "accounts": {
                  Row: {
                    "created_at": string,"household_id": string,"id": string,"institution": string | null,"is_archived": boolean,"is_liability": boolean | null,"last4": string | null,"name": string,"owner_user_id": string | null,"sort_order": number,"type": Database["public"]['Enums']["account_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id": string,"id"?: string,"institution"?: string | null,"is_archived"?: boolean,"is_liability"?: never,"last4"?: string | null,"name": string,"owner_user_id"?: string | null,"sort_order"?: number,"type": Database["public"]['Enums']["account_type"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"id"?: string,"institution"?: string | null,"is_archived"?: boolean,"is_liability"?: never,"last4"?: string | null,"name"?: string,"owner_user_id"?: string | null,"sort_order"?: number,"type"?: Database["public"]['Enums']["account_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounts_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accounts_household_id_owner_user_id_fkey"
      columns: ["household_id","owner_user_id"]
isOneToOne: false
      referencedRelation: "household_members"
      referencedColumns: ["household_id","user_id"]
    }
                  ]
                },"balance_snapshots": {
                  Row: {
                    "account_id": string,"as_of": string,"balance_cents": number,"created_at": string,"household_id": string,"id": string,"import_id": string | null,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"as_of": string,"balance_cents": number,"created_at"?: string,"household_id": string,"id"?: string,"import_id"?: string | null,"source": string
                  }
                  Update: {
                    "account_id"?: string,"as_of"?: string,"balance_cents"?: number,"created_at"?: string,"household_id"?: string,"id"?: string,"import_id"?: string | null,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "balance_snapshots_household_id_account_id_fkey"
      columns: ["household_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "balance_snapshots_import_id_fkey"
      columns: ["import_id"]
isOneToOne: false
      referencedRelation: "imports"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"household_id": string,"id": string,"is_archived": boolean,"is_shared": boolean,"kind": Database["public"]['Enums']["category_kind"],"name": string,"parent_id": string | null,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id": string,"id"?: string,"is_archived"?: boolean,"is_shared"?: boolean,"kind"?: Database["public"]['Enums']["category_kind"],"name": string,"parent_id"?: string | null,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"id"?: string,"is_archived"?: boolean,"is_shared"?: boolean,"kind"?: Database["public"]['Enums']["category_kind"],"name"?: string,"parent_id"?: string | null,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "categories_household_id_parent_id_fkey"
      columns: ["household_id","parent_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"category_rules": {
                  Row: {
                    "account_id": string | null,"amount_max_cents": number | null,"amount_min_cents": number | null,"created_at": string,"field": Database["public"]['Enums']["rule_field"],"household_id": string,"id": string,"match_type": Database["public"]['Enums']["rule_match"],"pattern": string,"priority": number,"set_category_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"amount_max_cents"?: number | null,"amount_min_cents"?: number | null,"created_at"?: string,"field"?: Database["public"]['Enums']["rule_field"],"household_id": string,"id"?: string,"match_type"?: Database["public"]['Enums']["rule_match"],"pattern": string,"priority"?: number,"set_category_id": string
                  }
                  Update: {
                    "account_id"?: string | null,"amount_max_cents"?: number | null,"amount_min_cents"?: number | null,"created_at"?: string,"field"?: Database["public"]['Enums']["rule_field"],"household_id"?: string,"id"?: string,"match_type"?: Database["public"]['Enums']["rule_match"],"pattern"?: string,"priority"?: number,"set_category_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "category_rules_household_id_account_id_fkey"
      columns: ["household_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "category_rules_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "category_rules_household_id_set_category_id_fkey"
      columns: ["household_id","set_category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"household_members": {
                  Row: {
                    "created_at": string,"display_name": string,"household_id": string,"role": Database["public"]['Enums']["member_role"],"split_weight": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"household_id": string,"role"?: Database["public"]['Enums']["member_role"],"split_weight"?: number,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"household_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"split_weight"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "household_members_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"households": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"shared_since": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"shared_since"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"shared_since"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"imports": {
                  Row: {
                    "account_id": string,"balance_at_export_cents": number | null,"created_at": string,"date_max": string | null,"date_min": string | null,"exported_on": string,"file_sha256": string,"format": string,"household_id": string,"id": string,"original_filename": string,"pending_replaced": boolean,"rows_duplicate": number,"rows_inserted": number,"rows_pending": number,"rows_skipped": number,"rows_total": number,"storage_path": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"balance_at_export_cents"?: number | null,"created_at"?: string,"date_max"?: string | null,"date_min"?: string | null,"exported_on": string,"file_sha256": string,"format": string,"household_id": string,"id"?: string,"original_filename": string,"pending_replaced"?: boolean,"rows_duplicate"?: number,"rows_inserted"?: number,"rows_pending"?: number,"rows_skipped"?: number,"rows_total"?: number,"storage_path": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"balance_at_export_cents"?: number | null,"created_at"?: string,"date_max"?: string | null,"date_min"?: string | null,"exported_on"?: string,"file_sha256"?: string,"format"?: string,"household_id"?: string,"id"?: string,"original_filename"?: string,"pending_replaced"?: boolean,"rows_duplicate"?: number,"rows_inserted"?: number,"rows_pending"?: number,"rows_skipped"?: number,"rows_total"?: number,"storage_path"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "imports_household_id_account_id_fkey"
      columns: ["household_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"manual_settlements": {
                  Row: {
                    "amount_cents": number,"created_at": string,"created_by": string | null,"from_user_id": string,"household_id": string,"id": string,"note": string | null,"settled_on": string,"to_user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"created_at"?: string,"created_by"?: string | null,"from_user_id": string,"household_id": string,"id"?: string,"note"?: string | null,"settled_on": string,"to_user_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"created_at"?: string,"created_by"?: string | null,"from_user_id"?: string,"household_id"?: string,"id"?: string,"note"?: string | null,"settled_on"?: string,"to_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "manual_settlements_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "manual_settlements_household_id_from_user_id_fkey"
      columns: ["household_id","from_user_id"]
isOneToOne: false
      referencedRelation: "household_members"
      referencedColumns: ["household_id","user_id"]
    },{
      foreignKeyName: "manual_settlements_household_id_to_user_id_fkey"
      columns: ["household_id","to_user_id"]
isOneToOne: false
      referencedRelation: "household_members"
      referencedColumns: ["household_id","user_id"]
    }
                  ]
                },"settlement_overrides": {
                  Row: {
                    "created_at": string,"household_id": string,"is_settlement": boolean,"out_txn_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id": string,"is_settlement": boolean,"out_txn_id": string
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"is_settlement"?: boolean,"out_txn_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "settlement_overrides_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "settlement_overrides_out_txn_id_fkey"
      columns: ["out_txn_id"]
isOneToOne: true
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"transactions": {
                  Row: {
                    "account_id": string,"amount_cents": number,"bank_category": string | null,"category_id": string | null,"category_source": Database["public"]['Enums']["category_source"],"created_at": string,"display_description": string,"fingerprint": string | null,"household_id": string,"id": string,"import_id": string | null,"notes": string | null,"occurrence": number | null,"posted_on": string,"raw_description": string,"shared_override": boolean | null,"status": Database["public"]['Enums']["txn_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_cents": number,"bank_category"?: string | null,"category_id"?: string | null,"category_source"?: Database["public"]['Enums']["category_source"],"created_at"?: string,"display_description": string,"fingerprint"?: string | null,"household_id": string,"id"?: string,"import_id"?: string | null,"notes"?: string | null,"occurrence"?: number | null,"posted_on": string,"raw_description": string,"shared_override"?: boolean | null,"status": Database["public"]['Enums']["txn_status"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"amount_cents"?: number,"bank_category"?: string | null,"category_id"?: string | null,"category_source"?: Database["public"]['Enums']["category_source"],"created_at"?: string,"display_description"?: string,"fingerprint"?: string | null,"household_id"?: string,"id"?: string,"import_id"?: string | null,"notes"?: string | null,"occurrence"?: number | null,"posted_on"?: string,"raw_description"?: string,"shared_override"?: boolean | null,"status"?: Database["public"]['Enums']["txn_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transactions_household_id_account_id_fkey"
      columns: ["household_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "transactions_household_id_category_id_fkey"
      columns: ["household_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "transactions_import_id_fkey"
      columns: ["import_id"]
isOneToOne: false
      referencedRelation: "imports"
      referencedColumns: ["id"]
    }
                  ]
                },"transfer_links": {
                  Row: {
                    "created_at": string,"household_id": string,"id": string,"in_txn_id": string,"out_txn_id": string,"status": Database["public"]['Enums']["transfer_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id": string,"id"?: string,"in_txn_id": string,"out_txn_id": string,"status": Database["public"]['Enums']["transfer_status"]
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"id"?: string,"in_txn_id"?: string,"out_txn_id"?: string,"status"?: Database["public"]['Enums']["transfer_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "transfer_links_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transfer_links_in_txn_id_fkey"
      columns: ["in_txn_id"]
isOneToOne: true
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transfer_links_out_txn_id_fkey"
      columns: ["out_txn_id"]
isOneToOne: true
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"transfer_rejections": {
                  Row: {
                    "created_at": string,"household_id": string,"in_txn_id": string,"out_txn_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id": string,"in_txn_id": string,"out_txn_id": string
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"in_txn_id"?: string,"out_txn_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transfer_rejections_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transfer_rejections_in_txn_id_fkey"
      columns: ["in_txn_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transfer_rejections_out_txn_id_fkey"
      columns: ["out_txn_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"user_preferences": {
                  Row: {
                    "dashboard_layout": Json | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "dashboard_layout"?: Json | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "dashboard_layout"?: Json | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_household_member":
{ Args: { "p_display_name": string,"p_email": string }; Returns: string
                           },
"balance_history":
{ Args: { "p_dates": (string)[] }; Returns: {
              "account_id": string,"anchor_date": string,"as_of": string,"balance_cents": number
            }[]
                           },
"confirm_transfer":
{ Args: { "p_link": string }; Returns: undefined
                           },
"create_household":
{ Args: { "p_display_name": string,"p_name": string }; Returns: string
                           },
"import_batch":
{ Args: { "p_account_id": string,"p_balance_cents"?: number,"p_exported_on": string,"p_file_sha256": string,"p_format": string,"p_original_filename": string,"p_rows": Json,"p_skip"?: (number)[],"p_storage_path": string }; Returns: Json
                           },
"link_transfer":
{ Args: { "p_a": string,"p_b": string }; Returns: string
                           },
"match_transfers":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"member_transfers":
{ Args: Record<PropertyKey, never>; Returns: {
              "amount_cents": number,"from_user": string,"is_settlement": boolean,"link_id": string,"out_txn_id": string,"received_on": string,"second_link": string,"sent_on": string,"to_user": string,"via_account": string
            }[]
                           },
"money_flows":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "cents": number,"kind": string,"source": string,"target": string
            }[]
                           },
"monthly_category_totals":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "category_id": string,"inflow_cents": number,"month": string,"outflow_cents": number,"txn_count": number
            }[]
                           },
"preview_category_rule":
{ Args: { "p_account_id"?: string,"p_amount_max_cents"?: number,"p_amount_min_cents"?: number,"p_field": Database["public"]['Enums']["rule_field"],"p_match_type": Database["public"]['Enums']["rule_match"],"p_pattern": string }; Returns: {
              "examples": (string)[],"manual": number,"matching": number
            }[]
                           },
"preview_import":
{ Args: { "p_account_id": string,"p_rows": Json }; Returns: {
              "ordinal": number,"outcome": string,"suspect": Json
            }[]
                           },
"set_transaction_category":
{ Args: { "p_category_id": string,"p_ids": (string)[] }; Returns: number
                           },
"shared_ledger":
{ Args: Record<PropertyKey, never>; Returns: {
              "cents": number,"creditor": string,"debtor": string,"description": string,"entry_date": string,"entry_kind": string,"ref_id": string,"total_cents": number
            }[]
                           },
"transfer_candidates":
{ Args: { "p_txn": string }; Returns: {
              "account_id": string,"already_linked": boolean,"amount_cents": number,"display_description": string,"exact_amount": boolean,"gap_days": number,"id": string,"posted_on": string
            }[]
                           },
"unlink_transfer":
{ Args: { "p_link": string }; Returns: undefined
                           }
          }
          Enums: {
            "account_type": "checking"|"savings"|"credit_card"|"mortgage"|"auto_loan"|"other_loan"|"other","category_kind": "expense"|"income"|"transfer","category_source": "none"|"rule"|"manual"|"transfer","member_role": "owner"|"member","rule_field": "description"|"bank_category","rule_match": "contains"|"starts_with"|"equals"|"regex","transfer_status": "auto"|"suggested"|"confirmed","txn_status": "posted"|"pending"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "account_type": ["checking", "savings", "credit_card", "mortgage", "auto_loan", "other_loan", "other"],"category_kind": ["expense", "income", "transfer"],"category_source": ["none", "rule", "manual", "transfer"],"member_role": ["owner", "member"],"rule_field": ["description", "bank_category"],"rule_match": ["contains", "starts_with", "equals", "regex"],"transfer_status": ["auto", "suggested", "confirmed"],"txn_status": ["posted", "pending"]
          }
        }
} as const
