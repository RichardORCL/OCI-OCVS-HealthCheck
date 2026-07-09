# Find all VMware SDDCs and get their details (OCI CLI)

These examples use the OCI Resource Search service to find all Oracle Cloud VMware
Solution (OCVS) SDDCs in the tenancy, then fetch the full details of each one with
the OCVS API.

They are designed to run in **OCI Cloud Shell** (Linux), where the OCI CLI and `jq`
are preinstalled and authentication is handled automatically — no `--profile` or
config setup is needed.


## ESXi hosts per cluster per SDDC

For every SDDC list its clusters, and for every cluster list its ESXi hosts with `oci ocvs esxi-host list`, reusing the cluster OCID and the compartment OCID. The cluster list is fetched once as JSON so we can loop over the cluster IDs with `jq`:

```bash
for id in $(oci search resource structured-search \
    --query-text "query vmwaresddc resources where lifecycleState != 'DELETED'" \
    --raw-output --query 'data.items[].identifier | join(`\n`, @)'); do
  sddc_json=$(oci ocvs sddc get --sddc-id "$id")
  sddc_name=$(jq -r '.data."display-name"' <<< "$sddc_json")
  vmware_version=$(jq -r '.data."vmware-software-version"' <<< "$sddc_json")
  compartment_id=$(jq -r '.data."compartment-id"' <<< "$sddc_json")

  echo
  echo "=============================================================="
  echo "SDDC:                    $sddc_name"
  echo "VMware software version: $vmware_version"
  echo "=============================================================="

  clusters_json=$(oci ocvs cluster list \
    --compartment-id "$compartment_id" \
    --sddc-id "$id" \
    --all)

  for cluster_id in $(jq -r '.data.items[].id' <<< "$clusters_json"); do
    cluster_name=$(jq -r --arg cid "$cluster_id" \
      '.data.items[] | select(.id == $cid) | ."display-name"' <<< "$clusters_json")

    echo
    echo "Cluster: $cluster_name"

    oci ocvs esxi-host list \
      --cluster-id "$cluster_id" \
      --compartment-id "$compartment_id" \
      --all |
    jq -r '
      ["display-name","compute-availability-domain","host-shape-name",
       "host-ocpu-count","current-commitment","billing-contract-end-date",
       "vcf-byol-allocation-id"],
      (.data.items[] |
        [ ."display-name",
          ."compute-availability-domain",
          ."host-shape-name",
          ."host-ocpu-count",
          ."current-commitment",
          (."billing-contract-end-date" // "-"),
          (."vcf-byol-allocation-id" // "-") ])
      | @tsv' |
    column -t -s $'\t'
  done
done
```